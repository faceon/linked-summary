import { LitElement, html, css } from "lit";
import "material-symbols/outlined.css";
import "@material/web/icon/icon.js";

export class TargetLink extends LitElement {
  static properties = {
    tabId: { type: Number },
    targetId: { type: String },
    isTabConnected: { type: Boolean },
    cutoff: { type: Number },
    sentences: { type: Array },
  };

  static styles = css`
    :host {
      display: inline-flex;
      width: 13px;
      height: 13px;
      margin-left: 5px;
    }

    button {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      border-radius: 4px;
      background-color: #dadadacc;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    button:hover {
      transform: scale(0.92);
      background-color: #8f8f8fcc;
    }

    button:focus-visible {
      outline: 1px solid #f28b82;
      outline-offset: 1px;
    }

    .material-symbols-outlined {
      font-size: 12px;
      line-height: 1;
    }
  `;

  constructor() {
    super();
    this.tabId = null;
    this.targetId = null;
    this.isTabConnected = false;
    this.cutoff = null;
    this.sentences = [];
  }

  willUpdate(changedProperties) {
    // if tabId is given, assume the tab is connected
    if (changedProperties.has("tabId") && this.tabId != null) {
      this.isTabConnected = true;
    }
  }

  async sendScrollTo(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isTabConnected) return;

    try {
      await chrome.tabs.sendMessage(this.tabId, {
        action: "SCROLL_TO",
        targetId: this.targetId,
      });
    } catch (error) {
      if (chrome?.runtime?.lastError) {
        console.debug(chrome.runtime.lastError.message);
      }
      this.isTabConnected = false;
    }
  }

  getFilteredSentenceTexts() {
    const candidateSentences = Array.isArray(this.sentences)
      ? this.sentences
      : [];
    const cutoffValue = Number.isFinite(this.cutoff) ? this.cutoff : null;

    const filtered =
      cutoffValue == null
        ? candidateSentences
        : candidateSentences.filter((sentence) => {
            const score = sentence?.score;
            return Number.isFinite(score) && score >= cutoffValue;
          });

    return filtered
      .map((sentence) => sentence?.text)
      .filter((text) => typeof text === "string" && text.trim().length > 0)
      .map((text) => text.trim());
  }

  async sendPutHighlight(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.isTabConnected) return;

    const sentences = this.getFilteredSentenceTexts();

    try {
      await chrome.tabs.sendMessage(this.tabId, {
        action: "PUT_HIGHLIGHT",
        targetId: this.targetId,
        sentences,
      });
    } catch (error) {
      if (chrome?.runtime?.lastError) {
        console.debug(chrome.runtime.lastError.message);
      }
      this.isTabConnected = false;
    }
  }

  async sendDimHighlight() {
    if (!this.isTabConnected) return;

    try {
      await chrome.tabs.sendMessage(this.tabId, {
        action: "DIM_HIGHLIGHT",
        targetId: null,
      });
    } catch (error) {
      if (chrome?.runtime?.lastError) {
        console.debug(chrome.runtime.lastError.message);
      }
      this.isTabConnected = false;
    }
  }

  getTooltipTitle() {
    const sentences = this.getFilteredSentenceTexts();
    if (!sentences.length) return "Highlight source";
    return sentences.join("\n");
  }

  render() {
    return html`
      <button
        aria-label="Highlight source"
        title=${this.getTooltipTitle()}
        @click=${this.sendScrollTo}
        @mouseenter=${this.sendPutHighlight}
        @mouseleave=${this.sendDimHighlight}
        @focus=${this.sendPutHighlight}
        @blur=${this.sendDimHighlight}
      >
        <md-icon class="material-symbols-outlined">link</md-icon>
      </button>
    `;
  }
}
