// badge labels shown on the extension action icon
export const BADGE = {
  IDLE: "",
  BUSY: "...",
  OPEN: "ON",
  ERROR: "❗",
};

// activity states used across UI to show progress/status
export const ACTIVITY = {
  IDLE: "idle",
  CHECKING_AI: "checking browser AI",
  PREPARING: "preparing summarizer",
  DOWNLOADING: "downloading summarizer",
  GENERATING: "generating summaries",
  REQUESTING_CONTENTS: "requesting contents",
  LINKING_TARGETS: "finding relevant sources",
};

const config = {
  // development mode
  isDevelopment: process.env.NODE_ENV === "development",

  BADGE,

  rootTopToWindowHeight: 0.33,

  // thresholds for readability
  minContentLength: 100,

  // text selectors' priority function
  maxTextDensity: 1500,
  minTextDensity: 50,
  textInclusionWeight: 0.5,
  textDensityWeight: 0.5,
  epsilon: 0.01, // to prevent NaN of Math.exp

  // control variables in choosing selectors based on text density
  minTextInTotalToReadability: 0.95,
  maxCountOfSearchingSelectors: 10,
  textDensityChangeThreshold: 0.5,

  // final threshold for targets
  maxTextContentForTarget: 3000,

  // media tags which are sizable
  mediaTags: ["IMG", "SVG", "VIDEO", "PRE", "FIGURE"],
  sizableMediaWidth: 200,
  sizableMediaHeight: 200,

  // iframes which include following keywords in attribute values are regarded as media
  // This is tech debt. We should find a better way to detect media iframes
  mediaIframeKeywords: ["CHART", "DWCDN", "YOUTUBE", "TWITTER", "INSTAGRAM"],

  // Ignore these when querySelectorAll(*)
  ignoredClasses: ["LPR__ignore"],
  ignoredIds: ["readability-content", "readability-page-1"],
  ignoredTags: [
    // 너무 큰 컨테이너들
    "HTML",
    "BODY",
    "HEAD",

    // 구조적 컨테이너들 (내용은 자식에 있음)
    "HEADER",
    "FOOTER",
    "NAV",
    "ASIDE",
    "MAIN",
    "SECTION",

    // 너무 작은 단위들
    "A", // 링크 - 보통 한 줄 이하
    "DT",
    "DD", // 정의 항목들 - 작은 단위
    "SPAN", // 인라인 요소

    // 목록 컨테이너 (내용은 LI에 있음)
    "UL",
    "OL",
    "DL",

    // 테이블 구조 (내용은 TD/TH에 있음)
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
  ],
  removableTags: [
    // 사용자에게 보이지 않는 콘텐츠
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",

    // 폼 요소들
    "BR",
    "HR",
    "INPUT",
    "BUTTON",
    "SELECT",
    "OPTION",
    "TEXTAREA",
    "LABEL",
    "IFRAME",

    // 메타데이터
    "META",
    "LINK",
    "TITLE",
    "BASE",

    // 구조만 정의 (텍스트 없음)
    "COL",
    "COLGROUP",
    "WBR",

    // SVG 하위 요소들
    "PATH",
    "G",
    "DEFS",
    "USE",
    "SYMBOL",

    // 임베드/플러그인
    "OBJECT",
    "EMBED",
    "PARAM",

    // 미디어 메타데이터
    "SOURCE",
    "TRACK",
    "AREA",
    "MAP",

    // 웹 컴포넌트/템플릿
    "TEMPLATE",
    "SLOT",

    // 그래픽/UI 요소
    "CANVAS",
    "METER",
    "PROGRESS",
    "DIALOG",

    // 폼 메타요소
    "DATALIST",
    "OPTGROUP",
  ],
};

// build querySelectorAll string without excluded classes, tags and ids
const { ignoredClasses, ignoredIds, ignoredTags } = config;
const notClasses = ignoredClasses
  .map((className) => `:not(.${className})`)
  .join("");
const notIds = ignoredIds.map((id) => `:not(#${id})`).join("");
const notTags = ignoredTags.map((tag) => `:not(${tag})`).join("");
config.allButExceptions = "*" + notClasses + notIds + notTags;

export default config;
