const HIGHLIGHT_CLASS = "highlightable";

function collectTextNodes(element, ignoreWhitespace = false) {
  // Helper function to check if node contains only whitespace
  function isAllWs(node) {
    return !/[^\t\n\r ]/.test(node.textContent);
  }

  // Helper function to check if node should be ignored
  function isIgnorable(node) {
    return node.nodeType === 8 || (node.nodeType === 3 && isAllWs(node));
  }

  // Create a filter function to skip ignorable nodes
  const filter = ignoreWhitespace
    ? {
        acceptNode: function (node) {
          return isIgnorable(node)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      }
    : null;

  // Create a tree walker with filter that skips ignorable nodes
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    filter,
  );

  const textNodes = [];
  while (walker.nextNode()) {
    const parentNode = walker.currentNode.parentNode;
    if (parentNode) {
      textNodes.push(walker.currentNode);
    }
  }

  return textNodes;
}

function createTextNodeRanges(textNodes) {
  // textNodes의 시작과 끝 위치를 계산하여 범위를 반환하는 함수
  let index = 0;
  return textNodes.map((node) => {
    const start = index;
    const end = start + node.nodeValue.length;
    index = end;
    return { node, start, end, text: node.nodeValue };
  });
}

function createLlmAdaptiveRegex(llmText) {
  // LLM이 생성한 텍스트를 본문에서 찾기 위해 정규 표현식을 생성하는 함수
  // LLM 텍스트는 고유의 패턴을 가질 수 있으므로 이를 보완할 필요가 있음

  // 숫자와 문자 또는 특수 문자가 붙어 있는 경우가 있으므로 분리
  const spaced = llmText
    .replace(/(\d+)([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d+)/g, "$1 $2")
    .replace(/(\d+)([%$#@!&*+=<>])/g, "$1 $2")
    .trim();

  // 모든 문장 부호를 공백으로 우선 대체
  const punctuations = ".,;:!?'\"\\-\u2018\u2019\u201C\u201D";
  const cleanedText = spaced.replace(new RegExp(`[${punctuations}]`, "g"), " ");

  // 공백을 기준으로 단어들로 분리
  const words = cleanedText
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")); // 단어 내 특수 문자를 이스케이프 처리

  // 이 단어들 사이에 모든 문장 부호를 허용하는 정규 표현식 삽입
  const separator = `[\\s${punctuations}]*`;
  const pattern = words.join(separator);

  return new RegExp(pattern, "gi");
}

function wrapRangeWithHighlight(startNode, startOffset, endNode, endOffset) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const span = document.createElement("span");
  span.classList.add(HIGHLIGHT_CLASS);
  span.appendChild(range.extractContents());
  range.insertNode(span);
}

function searchSnippetBorder(snippet, textContent, fromStart = true) {
  // snippet의 시작 부분 또는 끝의 일부분을 검색하여 해당 위치를 찾는 함수

  // 우선 snippet의 최소 길이부터 검색
  let searchLength = 2;

  // snippet이 textContent 안에 들어오는 크기인지 확인
  if (snippet.length < searchLength) {
    throw new Error(`"${snippet}" does not fit in the textContent`);
  }

  // 검색 가능한 최대 길이를 설정
  const maxLength = Math.min(20, Math.floor(snippet.length));

  while (searchLength <= snippet.length && searchLength <= maxLength) {
    // snippet 전체를 검색하지 않고 조각만 검색
    const partialSnippet = fromStart
      ? snippet.slice(0, searchLength) // fromStart이면 snippet의 시작 부분
      : snippet.slice(-searchLength); // fromStart가 아니면 snippet의 끝 부분

    // 조각의 정규 표현식 생성
    const partialRegex = createLlmAdaptiveRegex(partialSnippet);

    // textContent에서 정규 표현식으로 검색
    const matches = Array.from(textContent.matchAll(partialRegex));

    if (matches.length === 1) {
      // 조각이 단 한곳에서 발견된다면 그곳이 원하는 위치
      return matches[0].index + (fromStart ? 0 : matches[0][0].length);
    } else if (matches.length > 1) {
      // 조각이 2곳 이상에서 발견된다면 조각을 키워 나간다
      searchLength++;
    } else if (matches.length === 0) {
      // 조각이 발견되지 않는다면 snippet 앞 또는 뒤에 불필요한 문자가 있을 수 있다.
      // 이 경우 snippet을 더 줄여서 검색한다
      const shrinkedSnippet = snippet.slice(fromStart ? 1 : 0, -1);
      return searchSnippetBorder(shrinkedSnippet, textContent, fromStart);
    }
  }

  throw new Error(`"${partialRegex}" can't be matched in the textContent`);
}

function markSnippetInElement(snippet, element) {
  let snippetStart, snippetEnd;

  // snippet 위치 찾기
  const index = element.textContent.indexOf(snippet);
  if (index !== -1) {
    // 정확히 일치하는 경우
    snippetStart = index;
    snippetEnd = index + snippet.length;
  } else {
    // 부분 일치 검색이 필요한 경우
    try {
      snippetStart = searchSnippetBorder(snippet, element.textContent, true);
      snippetEnd = searchSnippetBorder(snippet, element.textContent, false);
    } catch (error) {
      throw error;
    }
  }

  // 텍스트 노드 준비
  const textNodes = collectTextNodes(element);
  if (textNodes.length === 0) {
    throw new Error("No text nodes found in the element");
  }

  const textNodeRanges = createTextNodeRanges(textNodes);

  // 시작점과 끝점 노드 찾기
  const startRange = textNodeRanges.find(
    ({ start, end }) => start <= snippetStart && snippetStart < end,
  );
  const endRange = textNodeRanges.find(
    ({ start, end }) => start <= snippetEnd && snippetEnd <= end,
  );

  if (!startRange || !endRange) {
    throw new error("Could not find text node ranges for snippet");
  }

  // 오프셋 계산 및 하이라이트
  const startOffset = snippetStart - startRange.start;
  const endOffset = snippetEnd - endRange.start;

  wrapRangeWithHighlight(
    startRange.node,
    startOffset,
    endRange.node,
    endOffset,
  );
}

export { markSnippetInElement };
