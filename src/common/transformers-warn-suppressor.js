const IGNORE_WARNINGS = [
  "Unable to determine content-length from response headers. Will expand buffer when needed.",
];

const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === "string" &&
    IGNORE_WARNINGS.some((msg) => args[0].includes(msg))
  ) {
    return;
  }
  originalWarn(...args);
};