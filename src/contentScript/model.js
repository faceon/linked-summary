import config from "../common/config.js";
import { isProbablyReaderable, Readability } from "@mozilla/readability";

export default class Model {
  isExtractable = (document = window.document) => {
    return isProbablyReaderable(document, {
      minContentLength: config.minContentLength,
    });
  };

  // Extract targets from document using readability
  findTargets = (document = window.document) => {
    // Create a copy of the document with unique IDs for element tracking
    const clonedDocument = this._cloneDocumentWithNodeId(document);

    // Parse the document to extract the main readable content with tags intact
    const readability = this._parseReadability(clonedDocument);
    if (readability.length < config.minContentLength) return;

    // Analyze element selectors and calculate their priorities based on text density and inclusion
    const stats = this._compilePriorityStats(readability);

    // Choose the most important elements from the readable content based on calculated priorities
    const clonedTargets = this._selectPriorityTargets(readability, stats);
    if (clonedTargets.length < config.minTargetsLength) return;

    // Map the selected elements back to their corresponding elements in the original document
    const originalTargets = this._matchOriginalTargets(clonedTargets, stats);
    if (originalTargets.length < config.minTargetsLength) return;

    // Discover media elements that exist within the target areas but weren't initially selected
    const missingMedia = this._findMissingMediaWithinTargets(originalTargets);

    // Combine the text targets with the discovered media elements into a single collection
    const mergedTargets = this._mergeElements(originalTargets, missingMedia);

    // Remove any targets that contain excessive amounts of text to avoid performance issues
    return mergedTargets.filter(
      (e) => e.textContent?.length <= config.maxTextContentForTarget,
    );
  };

  // Create a document clone with nodeId in each element
  _cloneDocumentWithNodeId = (document = window.document) => {
    let index = 0;

    document
      .querySelectorAll(config.allButExceptions)
      .forEach((e) => (e.dataset.nodeId = ++index));

    const documentClone = document.cloneNode(true);
    // Remove all tags that belong to removable tags
    const removableSelector = config.removableTags.join(", ");
    documentClone.querySelectorAll(removableSelector).forEach((e) => {
      e.remove();
    });
    return documentClone;
  };

  // Parse readability which signifies main contents in document
  _parseReadability = (clonedDocument) => {
    try {
      const options = { keepClasses: true, serializer: (el) => el };
      return new Readability(clonedDocument, options).parse();
    } catch (error) {
      return { length: 0, error };
    }
  };

  // Rate priority of tags by compiling statistics of selectors
  _compilePriorityStats = (readability) => {
    const { content, length: readabilityLength } = readability;
    const elementsInContent = content.querySelectorAll(config.allButExceptions);
    const selectorStats = this._extractSelectors(elementsInContent);
    const specificSelectorStats = this._specifySelectors(selectorStats);
    const textDensityStats = this._populateTextDensity(
      content,
      specificSelectorStats,
    );
    const priorityStats = this._populatePriorities(
      textDensityStats,
      readabilityLength,
    );

    return Object.values(priorityStats).sort((a, b) => b.priority - a.priority);
  };

  // Extract unique selectors in elements
  _extractSelectors = (elements) => {
    const stats = {};

    const parseSelector = (element) => {
      const tag = element.tagName;
      let classes;

      // Cases of empty class name are categorized as following
      // 1. <p>: undefined
      // 2. <p class>, <p class="">: null
      // 3. <p class="1A">: "" (if class name is in ineligible format)

      if (!element.hasAttribute("class")) {
        classes = undefined;
      } else if (element.className === "") {
        classes = null;
      } else if (typeof element.className === "string") {
        const classNameRegex = /^[-_a-zA-Z][-_a-zA-Z0-9]*$/;
        classes = element.className
          .trim()
          .split(" ")
          .filter((e) => classNameRegex.test(e))
          .sort()
          .join(".");
      } else {
        classes = "";
      }

      const selector = tag + (classes ? `.${classes}` : "");

      return { selector, tag, classes };
    };

    elements.forEach((element) => {
      const { selector, tag, classes } = parseSelector(element);
      if (!stats[selector]) stats[selector] = { tag, classes };
    });

    return stats;
  };

  // Add specific selectors by excluding classes in the same tags
  _specifySelectors = (stats) => {
    const selectors = Object.keys(stats);

    while (selectors.length) {
      const selector = selectors.shift();
      const { tag, classes } = stats[selector];
      let pseudoClasses;

      if (classes) {
        const sameTagSelectors = selectors.filter((e) => stats[e].tag === tag);
        const sameTagClasses = sameTagSelectors
          .map((e) => stats[e].classes)
          .filter((e) => e !== null);
        pseudoClasses = sameTagClasses.length
          ? sameTagClasses.reduce((acc, classes) => {
              acc += `:not(.${classes})`;
              return acc;
            }, "")
          : "";
      } else {
        // classes undefined or null
        pseudoClasses = `:not([class]), ${selector}[class=""]`;
      }

      stats[selector].specificSelector = selector + pseudoClasses;
    }

    return stats;
  };

  // Populate text densities of elements selected by specific selectors
  _populateTextDensity = (content, stats) => {
    for (const selector in stats) {
      let count = 0;
      let textIncluded = 0;
      const { specificSelector } = stats[selector];
      content.querySelectorAll(specificSelector).forEach((elem) => {
        count++;
        textIncluded += elem.textContent.length;
      });
      stats[selector].count = count;
      stats[selector].textIncluded = textIncluded;
    }

    for (const selector in stats) {
      const { count, textIncluded } = stats[selector];
      stats[selector].textDensity = textIncluded / count;
    }

    return stats;
  };

  // Populate selectors' priority
  _populatePriorities = (stats, readabilityLength) => {
    // Summarize stats to compute mean and standard deviations of text density
    const eligibleTextDensity = Object.values(stats).filter((row) =>
      this._isEligibleTextDensity(row.textDensity),
    );
    const totalTextIncluded = eligibleTextDensity.reduce(
      (acc, row) => acc + row.textIncluded,
      0,
    );
    const totalCount = eligibleTextDensity.reduce(
      (acc, row) => acc + row.count,
      0,
    );
    const meanTextDensity = totalTextIncluded / totalCount;
    const totalSquareDifferences = eligibleTextDensity.reduce(
      (acc, row) =>
        acc + Math.pow(meanTextDensity - row.textDensity, 2) * row.count,
      0,
    );
    const stdDevTextDensity = Math.sqrt(totalSquareDifferences / totalCount);

    // A selector's priority is computed using text inclusion ratio and density
    const computePriority = (textIncluded, textDensity) => {
      const textInclusionRatio = textIncluded / readabilityLength;
      const textDensityGaussian = Math.exp(
        0 -
          (textDensity - meanTextDensity + config.epsilon) ** 2 /
            (2 * (stdDevTextDensity + config.epsilon) ** 2),
      );
      const priority =
        config.textInclusionWeight * textInclusionRatio +
        config.textDensityWeight * textDensityGaussian;

      return priority;
    };

    for (const selector in stats) {
      const { textIncluded, textDensity } = stats[selector];
      stats[selector].priority = computePriority(textIncluded, textDensity);
    }

    return stats;
  };

  // Check if the text density of a certain tag is within the eligible range
  _isEligibleTextDensity = (textDensity) => {
    return (
      textDensity > config.minTextDensity && textDensity < config.maxTextDensity
    );
  };

  // Select high priority targets from readability content using priority statistics
  _selectPriorityTargets = (readability, stats) => {
    const { content, length: readabilityLength } = readability;
    const highPriorities = [];
    const mediaSelectors = [];
    const textSelectors = [];

    // Split selectors into media and text selectors
    for (const selector in stats) {
      const { tag, textDensity } = stats[selector];
      if (this._isMediaTag(tag)) {
        mediaSelectors.push(selector);
      } else if (this._isEligibleTextDensity(textDensity)) {
        textSelectors.push(selector);
      }
    }

    // Add all of media elements larger than certain sizes
    for (const selector of mediaSelectors) {
      const { specificSelector } = stats[selector];
      Array.from(content.querySelectorAll(specificSelector))
        .filter(this.isMediaSizable)
        .forEach((media) => {
          highPriorities.push(media);
          media.remove(); // remove elements from content
          stats[selector].used = true;
        });
    }

    // Add text elements order by priority until they collectively include enough text
    textSelectors.sort((a, b) => stats[b].priority - stats[a].priority);
    let textInTotal = 0;
    let textInTotalToReadability = 0;
    let countOfSearchingSelectors = 0;
    const commonClassSelectors = [];

    while (true) {
      let currSelector;
      const moreRoomToSearch =
        textSelectors.length > 0 &&
        textInTotalToReadability < config.minTextInTotalToReadability &&
        countOfSearchingSelectors < config.maxCountOfSearchingSelectors;

      if (commonClassSelectors.length > 0) {
        currSelector = commonClassSelectors.shift();
      } else if (moreRoomToSearch) {
        currSelector = textSelectors.shift();
      } else {
        break;
      }

      const { specificSelector } = stats[currSelector];
      const currElements = Array.from(
        content.querySelectorAll(specificSelector),
      );
      if (currElements.length === 0) continue;

      // Find out how much text density has changed since compiling stats
      const sumText = (acc, node) => acc + node.textContent.length;
      const updatedTextIncluded = currElements.reduce(sumText, 0);
      const updatedTextDensity = updatedTextIncluded / currElements.length;
      const compiledTextDensity = stats[currSelector].textDensity;
      const textDensityChange = Math.abs(
        (updatedTextDensity - compiledTextDensity) / compiledTextDensity,
      );
      if (textDensityChange > config.textDensityChangeThreshold) continue;

      // Add curr elements' text to text in total
      textInTotal += updatedTextIncluded;
      textInTotalToReadability = textInTotal / readabilityLength;
      countOfSearchingSelectors++;
      stats[currSelector].used = true;
      highPriorities.push(...currElements);
      currElements.forEach((node) => node.remove());

      // Search textSelectors if any selector share any class with currSelector
      if (!stats[currSelector].classes) continue;
      const currClasses = stats[currSelector].classes.split(".");
      for (const otherSelector of textSelectors) {
        const otherClasses = stats[otherSelector].classes?.split(".");
        if (otherClasses?.some((e) => currClasses.includes(e))) {
          commonClassSelectors.push(otherSelector);
          textSelectors.splice(textSelectors.indexOf(otherSelector));
        }
      }
    }

    return highPriorities;
  };

  // Find original targets which are matched with cloned targets
  _matchOriginalTargets = (clonedTargets, stats) => {
    // Find original targets if they exist in cloned targets
    let originalTargets = []; // Original targets which were matched with cloned targets

    const nodeIdMap = new Map();
    const allElementsWithNodeId = document.querySelectorAll(`[data-node-id]`);

    // Populate cloned targets map
    clonedTargets.forEach((clone) => {
      const i = clone.dataset.nodeId;
      nodeIdMap.set(i, clone);
    });

    // Split all elements with node index into matched and unmatched
    allElementsWithNodeId.forEach((element) => {
      const { nodeId } = element.dataset;
      if (nodeIdMap.has(nodeId)) {
        originalTargets.push(element);
      } else {
        element.removeAttribute("data-node-id");
      }
    });

    // Find potential original targets which have used specific selectors
    // but were not included in cloned targets for some reasons
    const usedSpecificSelectors = Object.values(stats)
      .filter((e) => e.used)
      .map((e) => e.specificSelector);

    usedSpecificSelectors.forEach((specificSelector) => {
      const elements = document.querySelectorAll(specificSelector);
      elements.forEach((element) => originalTargets.push(element));
    });

    // Remove potential duplicates
    originalTargets = Array.from(new Set(originalTargets));

    // Filter out null, too small, empty element
    originalTargets = originalTargets
      .filter((e) => e !== null)
      .filter((e) => e !== undefined)
      .filter((e) => e.getBoundingClientRect().width > 0)
      .filter((e) => e.getBoundingClientRect().height > 0)
      .filter((e) => this._isMediaTag(e) || e.textContent.length);

    // Sort order by top position
    originalTargets = this._sortByTop(originalTargets);

    return originalTargets;
  };

  // Find missing media within the targets
  _findMissingMediaWithinTargets = (originalTargets) => {
    const elementsInOriginal = Array.from(
      document.querySelectorAll(config.allButExceptions),
    );
    const mediaInOriginal = elementsInOriginal.filter((element) =>
      config.mediaTags.includes(element.tagName.toUpperCase()),
    );

    // check if an iframe contains chart like media
    const isMediaInIframe = (iframe) => {
      const attributes = iframe.attributes;
      let attributeString = "";

      for (let i = 0; i < attributes.length; i++) {
        attributeString += `${attributes[i].name}="${attributes[i].value}" `;
      }
      attributeString = attributeString.trim().toUpperCase();

      return config.mediaIframeKeywords.some((keyword) =>
        attributeString.includes(keyword),
      );
    };

    const iframeIncludingMedia = Array.from(document.querySelectorAll("iframe"))
      .filter(this.isMediaSizable)
      .filter(isMediaInIframe);

    const allMedia = mediaInOriginal.concat(iframeIncludingMedia);
    const missingMedia = allMedia.filter((e) => !originalTargets.includes(e));
    const sizableMedia = missingMedia.filter(this.isMediaSizable);

    // Filter by target range within the function
    return sizableMedia.filter((e) =>
      this._isInsideTargets(e, originalTargets),
    );
  };

  // Check if the element is a media tag
  _isMediaTag = (elementOrTag) => {
    let tag;

    if (elementOrTag instanceof Element) {
      tag = elementOrTag.tagName;
    } else if (typeof elementOrTag === "string") {
      tag = elementOrTag;
    } else {
      return false;
    }

    return config.mediaTags.includes(tag.toUpperCase());
  };

  // Check if the element is sizable media
  isMediaSizable = (element) => {
    return (
      element.getBoundingClientRect().width >= config.sizableMediaWidth ||
      element.getBoundingClientRect().height >= config.sizableMediaHeight
    );
  };

  // Sort elements by top position (returns new array if not already sorted)
  _sortByTop = (elements) => {
    // Check if already sorted while getting positions
    const positions = elements.map((e) => e.getBoundingClientRect().top);
    const isSorted = positions.every(
      (pos, i) => i === 0 || pos >= positions[i - 1],
    );

    // Return original array if already sorted, otherwise return sorted copy
    return isSorted
      ? elements
      : elements.sort(
          (a, b) =>
            a.getBoundingClientRect().top - b.getBoundingClientRect().top,
        );
  };

  // Check if the element is inside the vertical range of targets
  _isInsideTargets = (element, targets) => {
    const sortedTargets = this._sortByTop(targets);
    const { top, bottom } = element.getBoundingClientRect();
    const topTargetRect = sortedTargets.at(0).getBoundingClientRect();
    const bottomTargetRect = sortedTargets.at(-1).getBoundingClientRect();
    const mostTop = topTargetRect.top;
    const mostBottom = bottomTargetRect.bottom;

    return bottom >= mostTop && top <= mostBottom;
  };

  _mergeElements = (targets, elements) => {
    // Convert single element to array
    const elementsArray = Array.isArray(elements) ? elements : [elements];

    // Return copy of original targets if no elements to merge
    if (elementsArray.length === 0) return [...targets];

    // Create new array with all elements merged
    const merged = [...targets, ...elementsArray];

    // Sort by vertical position
    return this._sortByTop(merged);
  };
}

// export isExtractable and findTargets only
const model = new Model();
export const isExtractable = () => model.isExtractable();
export const findTargets = () => model.findTargets();
