import "./contentScript.css";
import config from "../common/config.js";
import { markSnippetInElement } from "./highlighter.js";
import { isExtractable, findTargets } from "./model.js";

class ContentScriptController {
  constructor() {
    this.isExtractable = isExtractable(document);
    this.setupMessageListeners();
    this.targets = findTargets(document);
    this.viewportHints = null;
  }

  setupMessageListeners() {
    const messageHandlers = {
      EXTRACT_CONTENTS: () => this.extractContents(document),
      SCROLL_TO: ({ targetId }) => this.scrollTo(targetId),
      PUT_HIGHLIGHT: ({ targetId, sentences }) => {
        return this.putHighlight(targetId, sentences);
      },
      DIM_HIGHLIGHT: () => this.dimHighlight(),
    };

    chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
      const action = message?.action;
      const handler = action ? messageHandlers[action] : undefined;
      if (!handler) return false;

      try {
        const result = handler(message);
        const response = { success: true };
        if (result && typeof result === "object" && !Array.isArray(result)) {
          Object.assign(response, result);
        } else if (result !== undefined) {
          response.result = result;
        }
        sendResponse(response);
      } catch (error) {
        console.error("Message handler error:", error?.message ?? error);
        sendResponse({
          success: false,
          error: {
            code: error?.code ?? "unknown_error",
            message: error?.message ?? "Unknown error occurred",
          },
        });
      }

      return true;
    });
  }

  extractContents = (document = window.document) => {
    try {
      if (this.isExtractable === false) {
        return {
          success: false,
          error: "The page does not have enough readable content.",
        };
      }

      const targetList = [];
      for (const target of this.targets) {
        const id = target.dataset.nodeId;
        const text = target.textContent
          .trim()
          .replace(/\s+/g, " ") // Replace multiple whitespaces with single space
          .replace(/\n+/g, " "); // Replace newlines with spaces

        if (!id || !text) continue;
        targetList.push({ id, text });
      }

      return {
        targets: targetList,
        docUrl: window.location.href,
        docTitle: document.title,
      };
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  findTargetElement = (targetId) => {
    try {
      const targetElement = document.querySelector(
        `[data-node-id="${targetId}"]`,
      );
      if (!targetElement) {
        throw new Error(`Target element with ID ${targetId} not found.`);
      }
      return targetElement;
    } catch (error) {
      console.error("Failed to find target element:", error);
      throw error;
    }
  };

  scrollTo = (targetId) => {
    try {
      const targetElement = this.findTargetElement(targetId);
      const elementTop =
        targetElement.getBoundingClientRect().top +
        window.scrollY -
        config.rootTopToWindowHeight * window.innerHeight;
      window.scrollTo({ top: elementTop, behavior: "smooth" });
      this.hideViewportHints();
      return true;
    } catch (error) {
      console.error("Failed to scroll to target:", error);
      return false;
    }
  };

  ensureViewportHints = () => {
    if (this.viewportHints?.top?.isConnected) {
      return this.viewportHints;
    }

    const existingTop = document.querySelector(".viewport-hint-top");
    const existingBottom = document.querySelector(".viewport-hint-bottom");

    const topElement = existingTop || document.createElement("div");
    topElement.className = "viewport-hint viewport-hint-top";
    if (!existingTop) {
      (document.body || document.documentElement).appendChild(topElement);
    }

    const bottomElement = existingBottom || document.createElement("div");
    bottomElement.className = "viewport-hint viewport-hint-bottom";
    if (!existingBottom) {
      (document.body || document.documentElement).appendChild(bottomElement);
    }

    this.viewportHints = {
      top: topElement,
      bottom: bottomElement,
    };

    return this.viewportHints;
  };

  showViewportHint = (position) => {
    const hints = this.ensureViewportHints();
    if (!hints) return;

    const shouldShowTop = position === "top";
    const shouldShowBottom = position === "bottom";

    hints.top.classList.toggle("viewport-hint-active", shouldShowTop);
    hints.bottom.classList.toggle("viewport-hint-active", shouldShowBottom);
  };

  hideViewportHints = () => {
    if (!this.viewportHints) return;
    const { top, bottom } = this.viewportHints;

    if (top) {
      top.classList.remove("viewport-hint-active");
    }
    if (bottom) {
      bottom.classList.remove("viewport-hint-active");
    }
  };

  clearHighlights = () => {
    try {
      const highlightedElements = document.querySelectorAll(".highlighted");
      highlightedElements.forEach((element) => {
        element.classList.remove("highlighted");
      });
    } catch (error) {
      console.warn("Failed to clear highlights:", error);
    }
  };

  putHighlight = (targetId, sentences) => {
    try {
      this.clearHighlights();
      const targetElement = this.findTargetElement(targetId);
      targetElement.classList.add("target-node");

      let highlightSpans = targetElement.querySelectorAll(".highlightable");

      if (highlightSpans.length === 0) {
        const normalizeWhitespace = (text) =>
          typeof text === "string" ? text.trim() : "";

        const normalizedSentences = Array.isArray(sentences)
          ? sentences
              .map((text) => normalizeWhitespace(text))
              .filter((text) => text && text.length > 0)
          : [];

        const highlightErrors = [];

        normalizedSentences.forEach((snippet) => {
          try {
            markSnippetInElement(snippet, targetElement, "highlightable");
          } catch (snippetError) {
            highlightErrors.push({ snippet, error: snippetError });
          }
        });

        if (highlightErrors.length) {
          console.debug("Failed to mark some snippets:", highlightErrors);
        }
      }

      highlightSpans = targetElement.querySelectorAll(".highlightable");
      highlightSpans.forEach((span) => span.classList.add("highlighted"));

      const rect = targetElement.getBoundingClientRect();
      const isAboveViewport = rect.bottom <= 0;
      const isBelowViewport = rect.top >= window.innerHeight;

      if (isAboveViewport) {
        this.showViewportHint("top");
      } else if (isBelowViewport) {
        this.showViewportHint("bottom");
      } else {
        this.hideViewportHints();
      }
      return true;
    } catch (error) {
      console.error("Failed to highlight target:", error);
      return false;
    }
  };

  dimHighlight = () => {
    try {
      this.clearHighlights();
      this.hideViewportHints();
      return true;
    } catch (error) {
      console.error("Failed to dim highlight:", error);
      return false;
    }
  };
}

export default new ContentScriptController();
