let transformersModulePromise = null;

async function loadTransformersModule() {
  if (!transformersModulePromise) {
    transformersModulePromise = import("@xenova/transformers")
      .then((module) => {
        const { env } = module;

        // Disable local model discovery to avoid failing fetches for non-existent packaged assets.
        env.allowLocalModels = false;

        // Disable multi-threading in WebAssembly backend and resolve runtime assets.
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("runtime/");

        return module;
      })
      .catch((error) => {
        transformersModulePromise = null;
        throw error;
      });
  }

  return transformersModulePromise;
}

let embeddingModel = null;
let embeddingModelPromise = null;

export async function ensureEmbeddingModel() {
  if (embeddingModel) {
    console.log("Using cached embeddings pipeline.");
    return embeddingModel;
  }
  if (!embeddingModelPromise) {
    embeddingModelPromise = loadEmbeddingModel()
      .then((model) => {
        embeddingModel = model;
        return model;
      })
      .catch((error) => {
        embeddingModelPromise = null;
        throw error;
      });
  } else {
    console.log("Awaiting shared embeddings pipeline load.");
  }
  return embeddingModelPromise;
}

export async function loadEmbeddingModel() {
  const { pipeline } = await loadTransformersModule();
  const attempts = [
    {
      modelId: "Xenova/all-MiniLM-L6-v2",
      quantized: true,
      label: "quantized (4-bit)",
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      console.log(
        `Attempting to load ${attempt.label} model: ${attempt.modelId}`,
      );
      const startTime = performance.now();
      let downloadInitiated = false;

      const instance = await pipeline("feature-extraction", attempt.modelId, {
        quantized: attempt.quantized,
        progress_callback: (progress) => {
          if (progress.status === "initiate" && !downloadInitiated) {
            console.log(`Initiating download for model: ${progress.name}`);
            downloadInitiated = true;
          }
        },
      });

      const endTime = performance.now();
      const downloadTime = endTime - startTime;
      console.log(`Model download completed in ${downloadTime.toFixed(2)} ms`);

      console.log(`Loaded ${attempt.label} weights successfully.`);
      return instance;
    } catch (error) {
      lastError = error;
      console.warn(`Failed to load ${attempt.label} weights: ${error.message}`);
    }
  }

  throw lastError ?? new Error("Unable to load embedding model.");
}

export async function generateEmbeddings(text, model) {
  try {
    return await model(text, { pooling: "mean", normalize: true });
  } catch (error) {
    console.error("Failed to generate embeddings:", error);
    throw error;
  }
}

export async function getEmbeddings(text) {
  try {
    const model = await ensureEmbeddingModel();
    return await generateEmbeddings(text, model);
  } catch (error) {
    console.error("Failed to fetch embeddings:", error);
    throw error;
  }
}

export function toVectorArray(embeddings) {
  if (!embeddings) return [];

  if (typeof embeddings.tolist === "function") {
    const list = embeddings.tolist();
    return Array.isArray(list[0]) ? list : [list];
  }

  if (Array.isArray(embeddings)) {
    return Array.isArray(embeddings[0]) ? embeddings : [embeddings];
  }

  if (embeddings.data && Array.isArray(embeddings.dims)) {
    const { data, dims } = embeddings;
    if (dims.length === 1) {
      return [Array.from(data)];
    }

    if (dims.length === 2) {
      const [rows, cols] = dims;
      const vectors = [];
      for (let row = 0; row < rows; row++) {
        const start = row * cols;
        vectors.push(Array.from(data.slice(start, start + cols)));
      }
      return vectors;
    }
  }

  return [];
}

function toMatrixView(embedding) {
  if (!embedding) return null;

  if (embedding.data && Array.isArray(embedding.dims)) {
    const dims =
      embedding.dims.length > 0 ? embedding.dims : [embedding.data.length];
    const rows = dims.length === 1 ? 1 : dims[0];
    const cols =
      dims.length === 1
        ? (dims[0] ?? embedding.data.length)
        : dims.slice(1).reduce((acc, val) => acc * val, 1);

    if (!rows || !cols) {
      return null;
    }

    return {
      data: embedding.data,
      rows,
      cols,
    };
  }

  const vectors = toVectorArray(embedding);
  if (!Array.isArray(vectors) || vectors.length === 0) {
    return null;
  }

  const cols = vectors[0]?.length ?? 0;
  if (!cols) {
    return null;
  }

  const rows = vectors.length;
  const data = new Float32Array(rows * cols);
  let offset = 0;
  for (let row = 0; row < rows; row++) {
    const vector = vectors[row] ?? [];
    for (let col = 0; col < cols; col++) {
      data[offset++] = vector[col] ?? 0;
    }
  }

  return {
    data,
    rows,
    cols,
  };
}

function dotProductAt(vectorA, offsetA, vectorB, offsetB, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += vectorA[offsetA + i] * vectorB[offsetB + i];
  }
  return sum;
}

function validateInputs(anchors, targets) {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return { ok: false, reason: "No anchors provided for similarity mapping." };
  }

  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, reason: "No targets provided for similarity mapping." };
  }

  return { ok: true };
}

async function getEmbeddingMatrices(anchors, targets) {
  const anchorTexts = anchors.map(({ text }) => text ?? "");
  const targetTexts = targets.map(({ text }) => text ?? "");

  if (targetTexts.length === 0) {
    return { anchorMatrix: null, targetMatrix: null };
  }

  const [anchorEmbeddings, targetEmbeddings] = await Promise.all([
    getEmbeddings(anchorTexts),
    getEmbeddings(targetTexts),
  ]);

  return {
    anchorMatrix: toMatrixView(anchorEmbeddings),
    targetMatrix: toMatrixView(targetEmbeddings),
  };
}

function validateMatrices(anchorMatrix, targetMatrix, anchors, targets) {
  if (
    !anchorMatrix ||
    !targetMatrix ||
    !anchorMatrix.cols ||
    !targetMatrix.cols
  ) {
    return false;
  }

  if (anchorMatrix.cols !== targetMatrix.cols) {
    console.warn("Mismatched embedding dimensions for similarity mapping.");
    return false;
  }

  const anchorRowCount = Math.min(anchorMatrix.rows, anchors.length);
  const targetRowCount = Math.min(targetMatrix.rows, targets.length);

  if (!anchorRowCount || !targetRowCount) {
    return false;
  }

  if (anchorMatrix.rows !== anchors.length) {
    console.warn(
      `Anchor embedding count mismatch: expected ${anchors.length}, got ${anchorMatrix.rows}.`,
    );
  }

  if (targetMatrix.rows !== targets.length) {
    console.warn(
      `Target embedding count mismatch: expected ${targets.length}, got ${targetMatrix.rows}.`,
    );
  }

  return true;
}

function initializeMatches(anchors) {
  const matchesById = new Map();
  anchors.forEach(({ id, text }) => {
    matchesById.set(id, {
      id,
      text,
      targets: [],
    });
  });
  return matchesById;
}

function assignBestTargets(
  anchors,
  targets,
  anchorMatrix,
  targetMatrix,
  matchesById,
) {
  const embeddingDim = anchorMatrix.cols;
  const anchorRowCount = Math.min(anchorMatrix.rows, anchors.length);
  const targetRowCount = Math.min(targetMatrix.rows, targets.length);
  const anchorData = anchorMatrix.data;
  const targetData = targetMatrix.data;

  for (let targetIndex = 0; targetIndex < targetRowCount; targetIndex++) {
    let bestScore = -Infinity;
    let bestMatch = null;
    const targetOffset = targetIndex * embeddingDim;

    for (let anchorIndex = 0; anchorIndex < anchorRowCount; anchorIndex++) {
      const anchorOffset = anchorIndex * embeddingDim;
      const score = dotProductAt(
        targetData,
        targetOffset,
        anchorData,
        anchorOffset,
        embeddingDim,
      );

      if (score > bestScore) {
        bestScore = score;
        bestMatch = anchors[anchorIndex];
      }
    }

    if (!bestMatch) continue;

    const targetItem = targets[targetIndex];
    if (!targetItem) continue;

    const match = matchesById.get(bestMatch.id);
    if (!match) continue;

    match.targets.push({
      id: targetItem.id,
      text: targetItem.text,
      score: bestScore,
    });
  }
}

function rankMatches(
  anchors,
  matchesById,
  similarityThreshold,
  maxMatchesPerAnchor,
) {
  return anchors.map(({ id, text }) => {
    const match = matchesById.get(id);
    const candidates = match?.targets ?? [];

    const passing = candidates.filter(
      ({ score }) => score >= similarityThreshold,
    );

    const prioritized = passing.length > 0 ? passing : candidates.slice(0, 1);

    const targets = prioritized.slice(0, maxMatchesPerAnchor);

    return { id, text: match?.text ?? text, targets };
  });
}

const DEFAULT_SENTENCE_FILTER_OPTIONS = {
  relativeWeight: 0.8, // Fraction of the top sentence score required to pass the relative cutoff.
  stdWeight: 0.5, // Multiplier for standard deviation when combining mean and spread-based cutoff.
  percentile: 0.75, // Quantile used to ensure the cutoff does not exceed the chosen percentile.
  minScore: -Infinity, // Lower bound to avoid cutting off very low but informative scores.
  lowSpreadWindow: 0.15, // Range threshold for treating sentence scores as tightly clustered.
  lowSpreadStdWeight: 0.25, // Reduced std weight applied when scores are tightly clustered.
  smallSampleSize: 3, // Sentence count threshold for triggering the small-sample adjustment.
  smallSampleRelativeWeight: 0.7, // Alternate relative weight when only a few sentences are present.
};

const SENTENCE_ABBREVIATIONS = new Set(
  [
    "dr.",
    "mr.",
    "mrs.",
    "ms.",
    "prof.",
    "sr.",
    "jr.",
    "st.",
    "vs.",
    "etc.",
    "i.e.",
    "e.g.",
    "u.s.",
  ].map((abbr) => abbr.toLowerCase()),
);

function endsWithAbbreviation(text) {
  if (!text) {
    return false;
  }

  const tokens = text.split(/\s+/);
  const lastTokenRaw = tokens[tokens.length - 1];
  if (!lastTokenRaw) {
    return false;
  }

  const normalized = lastTokenRaw
    .replace(/^["'“”‘’(\[]+/, "")
    .replace(/["'“”‘’)\]]+$/, "")
    .toLowerCase();

  return SENTENCE_ABBREVIATIONS.has(normalized);
}

function splitTextIntoSentences(text) {
  if (typeof Intl === "undefined" || !Intl.Segmenter) {
    return [text];
  }

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const segments = segmenter.segment(text);
  const sentences = [];
  let buffer = "";

  for (const { segment } of segments) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      const candidate = buffer ? `${buffer} ${trimmed}`.trim() : trimmed;

      if (endsWithAbbreviation(candidate)) {
        buffer = candidate;
        continue;
      }

      sentences.push(candidate);
      buffer = "";
    }
  }

  if (buffer) {
    sentences.push(buffer);
  }

  return sentences;
}

function computeQuantile(scores, percentile) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return null;
  }

  if (!Number.isFinite(percentile)) {
    return null;
  }

  const clamped = Math.min(Math.max(percentile, 0), 1);
  if (clamped === 0) {
    return Math.min(...scores);
  }
  if (clamped === 1) {
    return Math.max(...scores);
  }

  const ordered = [...scores].sort((a, b) => a - b);
  const index = (ordered.length - 1) * clamped;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return ordered[lowerIndex];
  }

  const interpolation = index - lowerIndex;
  return (
    ordered[lowerIndex] * (1 - interpolation) +
    ordered[upperIndex] * interpolation
  );
}

function computeSentenceCutoff(scores, options = {}) {
  if (!Array.isArray(scores) || scores.length === 0) {
    return null;
  }

  const mergedOptions = {
    ...DEFAULT_SENTENCE_FILTER_OPTIONS,
    ...(options ?? {}),
  };

  const {
    relativeWeight,
    stdWeight,
    percentile,
    minScore,
    lowSpreadWindow,
    lowSpreadStdWeight,
    smallSampleSize,
    smallSampleRelativeWeight,
  } = mergedOptions;

  const maxScore = Math.max(...scores);
  const minObservedScore = Math.min(...scores);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance =
    scores.reduce((acc, value) => {
      const delta = value - mean;
      return acc + delta * delta;
    }, 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  const sampleSize = scores.length;
  const boundedSmallSampleSize = Math.max(Math.floor(smallSampleSize) || 0, 0);

  const boundedRelativeWeight = Number.isFinite(relativeWeight)
    ? Math.min(Math.max(relativeWeight, 0), 1)
    : DEFAULT_SENTENCE_FILTER_OPTIONS.relativeWeight;

  const boundedSmallSampleRelative = Number.isFinite(smallSampleRelativeWeight)
    ? Math.min(Math.max(smallSampleRelativeWeight, 0), 1)
    : DEFAULT_SENTENCE_FILTER_OPTIONS.smallSampleRelativeWeight;

  const effectiveRelativeWeight =
    sampleSize <= boundedSmallSampleSize && boundedSmallSampleSize > 0
      ? Math.min(boundedRelativeWeight, boundedSmallSampleRelative)
      : boundedRelativeWeight;

  const relativeCutoff = maxScore * effectiveRelativeWeight;

  const effectiveStdWeight = Number.isFinite(stdWeight)
    ? Math.max(stdWeight, 0)
    : DEFAULT_SENTENCE_FILTER_OPTIONS.stdWeight;
  let statsCutoff = mean + effectiveStdWeight * stdDev;

  const spread = maxScore - minObservedScore;
  const boundedLowSpreadWindow = Number.isFinite(lowSpreadWindow)
    ? Math.max(lowSpreadWindow, 0)
    : DEFAULT_SENTENCE_FILTER_OPTIONS.lowSpreadWindow;

  if (spread <= boundedLowSpreadWindow) {
    const boundedLowSpreadStdWeight = Number.isFinite(lowSpreadStdWeight)
      ? Math.max(lowSpreadStdWeight, 0)
      : DEFAULT_SENTENCE_FILTER_OPTIONS.lowSpreadStdWeight;
    statsCutoff = Math.min(
      statsCutoff,
      mean + boundedLowSpreadStdWeight * stdDev,
    );
  }

  const percentileCutoff = computeQuantile(scores, percentile);

  let combinedCutoff = (relativeCutoff + statsCutoff) / 2;

  if (Number.isFinite(percentileCutoff)) {
    combinedCutoff = Math.min(combinedCutoff, percentileCutoff);
  }

  const boundedMinScore = Number.isFinite(minScore)
    ? minScore
    : DEFAULT_SENTENCE_FILTER_OPTIONS.minScore;

  combinedCutoff = Math.max(boundedMinScore, combinedCutoff);
  combinedCutoff = Math.min(combinedCutoff, maxScore);

  if (!Number.isFinite(combinedCutoff)) {
    return maxScore;
  }

  return combinedCutoff;
}

function selectSentencesWithCutoff(sentences, options = {}) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return { cutoff: null, sentences: [] };
  }

  const ordered = [...sentences].sort((a, b) => a.order - b.order);
  const scores = ordered.map((item) => item.score);
  const cutoff = computeSentenceCutoff(scores, options);

  return {
    cutoff,
    sentences: ordered.map(({ text, score }) => ({ text, score })),
  };
}

async function annotateSpecificMatches(
  anchors,
  matchesById,
  anchorMatrix,
  sentenceFilterOptions,
) {
  if (!anchorMatrix?.data || !anchorMatrix.cols) {
    return;
  }

  const anchorRowCount = Math.min(anchorMatrix.rows ?? 0, anchors.length);
  if (!anchorRowCount) {
    return;
  }

  const anchorIndexById = new Map();
  for (let index = 0; index < anchorRowCount; index++) {
    const anchor = anchors[index];
    if (!anchor || anchor.id == null) {
      continue;
    }
    anchorIndexById.set(anchor.id, index);
  }

  const sentenceTexts = [];
  const sentenceMeta = [];

  for (const anchor of anchors) {
    if (!anchor) continue;
    const anchorIndex = anchorIndexById.get(anchor.id);
    if (anchorIndex == null) continue;

    const match = matchesById.get(anchor.id);
    const targets = match?.targets;
    if (!Array.isArray(targets) || targets.length === 0) continue;

    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const target = targets[targetIndex];
      if (!target?.text) continue;

      const sentences = splitTextIntoSentences(target.text);
      if (!Array.isArray(sentences) || sentences.length === 0) continue;

      const key = `${anchor.id}::${target.id ?? targetIndex}`;

      for (
        let sentenceIndex = 0;
        sentenceIndex < sentences.length;
        sentenceIndex++
      ) {
        const sentence = sentences[sentenceIndex];
        if (!sentence) continue;
        sentenceMeta.push({ key, anchorIndex, order: sentenceIndex });
        sentenceTexts.push(sentence);
      }
    }
  }

  if (sentenceTexts.length === 0) {
    return;
  }

  let sentenceEmbeddings;
  try {
    sentenceEmbeddings = await getEmbeddings(sentenceTexts);
  } catch (error) {
    console.warn(
      "Failed to compute sentence embeddings for specific text selection.",
      error,
    );
    return;
  }

  const sentenceMatrix = toMatrixView(sentenceEmbeddings);
  if (!sentenceMatrix || sentenceMatrix.cols !== anchorMatrix.cols) {
    console.warn(
      "Sentence embeddings unavailable or mismatched for specific text selection.",
    );
    return;
  }

  const embeddingDim = anchorMatrix.cols;
  const anchorData = anchorMatrix.data;
  const sentenceData = sentenceMatrix.data;
  const totalRows = Math.min(
    sentenceMatrix.rows ?? 0,
    sentenceMeta.length,
    sentenceTexts.length,
  );

  if (!totalRows) {
    return;
  }

  if (totalRows !== sentenceMeta.length) {
    console.warn(
      "Sentence embedding row count mismatch; specific text selection may be incomplete.",
    );
  }

  const sentencesByKey = new Map();

  for (let row = 0; row < totalRows; row++) {
    const meta = sentenceMeta[row];
    const anchorOffset = meta.anchorIndex * embeddingDim;
    const sentenceOffset = row * embeddingDim;
    const score = dotProductAt(
      anchorData,
      anchorOffset,
      sentenceData,
      sentenceOffset,
      embeddingDim,
    );

    let entries = sentencesByKey.get(meta.key);
    if (!entries) {
      entries = [];
      sentencesByKey.set(meta.key, entries);
    }

    entries.push({
      text: sentenceTexts[row],
      score,
      order: meta.order,
    });
  }

  for (const anchor of anchors) {
    const match = matchesById.get(anchor.id);
    if (!match || !Array.isArray(match.targets)) continue;

    match.targets.forEach((target, targetIndex) => {
      const key = `${anchor.id}::${target.id ?? targetIndex}`;
      const sentenceEntries = sentencesByKey.get(key);

      if (Array.isArray(sentenceEntries) && sentenceEntries.length > 0) {
        const { cutoff, sentences } = selectSentencesWithCutoff(
          sentenceEntries,
          sentenceFilterOptions,
        );

        if (Number.isFinite(cutoff)) {
          target.cutoff = cutoff;
        }

        target.sentences = sentences;
      }

      if (target.snippets) {
        delete target.snippets;
      }

      if (target.specificText) {
        delete target.specificText;
      }
    });
  }
}

export async function computeSemanticMatches(anchors, targets, options = {}) {
  const {
    similarityThreshold = 0.5,
    maxMatchesPerAnchor = 3,
    sentenceFilter: sentenceFilterOptions = {},
  } = options;

  const validation = validateInputs(anchors, targets);
  if (!validation.ok) {
    console.warn(validation.reason);
    return [];
  }

  const { anchorMatrix, targetMatrix } = await getEmbeddingMatrices(
    anchors,
    targets,
  );

  if (!anchorMatrix || !targetMatrix) {
    console.warn("Missing embeddings for similarity mapping.");
    return [];
  }

  if (!validateMatrices(anchorMatrix, targetMatrix, anchors, targets)) {
    return [];
  }

  const matchesById = initializeMatches(anchors);

  assignBestTargets(anchors, targets, anchorMatrix, targetMatrix, matchesById);

  await annotateSpecificMatches(
    anchors,
    matchesById,
    anchorMatrix,
    sentenceFilterOptions,
  );

  return rankMatches(
    anchors,
    matchesById,
    similarityThreshold,
    maxMatchesPerAnchor,
  );
}
