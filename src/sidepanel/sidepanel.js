// UI
import "./sidepanel.css";
import "material-symbols/outlined.css";
import "@material/web/button/outlined-button.js";
import "@material/web/progress/linear-progress.js";
import { LitElement, html, css } from "lit";
import { repeat } from "lit/directives/repeat.js";

// Functionality
import { ACTIVITY, BADGE } from "../common/config.js";
import { extractContentsFromTab } from "../common/extractContents.js";
import { KeyPoint } from "./components/KeyPoint.js";
import { TargetLink } from "./components/TargetLink.js";
import { createKeyPointStream } from "./keyPointStream.js";
import { computeSemanticMatches } from "./localTransformer.js";

class Sidepanel extends LitElement {
  static styles = css`
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .summarize-button {
      text-align: left;
      width: 130px;
    }

    .activity-indicator {
-     justify-content: center;
+     display: flex;
+     align-items: center;
    }

    .activity-indicator md-linear-progress  {
      width: 130px
    }

  `;

  static properties = {
    tabId: { type: Number },
    tabState: { type: Object },
    targets: { type: Array },
    keyPoints: { type: Array },
    linkedTargets: { type: Array },
    activity: { type: Object },
  };

  constructor() {
    super();
    this.targets = [];
    this.keyPoints = [];
    this.linkedTargets = [];
    this.activity = ACTIVITY.IDLE;
    this.setupSidePanelClousureListeners();
  }

  render() {
    return html`
      ${this.tabState?.error ? html`<h3>${this.tabState.error}</h3>` : ""}

      <div class="controls">
        <!-- summarize button -->
        <md-outlined-button
          class="summarize-button"
          @click=${this.sendNewContentsRequest}
          .disabled=${this.activity !== ACTIVITY.IDLE}
        >
          ${this.activity === ACTIVITY.IDLE
            ? html`summarize`
            : html`summarizing`}
        </md-outlined-button>

        <!-- activity indicator -->
        <div
          class="activity-indicator"
          ?hidden=${this.activity === ACTIVITY.IDLE}
        >
          <md-linear-progress indeterminate></md-linear-progress>
          <md-text> ${this.activity} </md-text>
        </div>
      </div>

      <!-- title -->
      <h2>${this.tabState?.docTitle}</h2>

      <!-- key points -->
      <div>
        ${repeat(
          this.keyPoints || [],
          ({ id }) => id,
          ({ text, id }) =>
            html`<key-point>
              <span class="key-point-text">${text}</span>
              ${repeat(
                this.linkedTargets?.[id]?.targets || [],
                ({ id: targetId }) => targetId,
                (targetEntry) =>
                  html`<target-link
                    .tabId=${this.tabId}
                    .targetId=${targetEntry?.id}
                    .cutoff=${targetEntry?.cutoff}
                    .sentences=${targetEntry?.sentences}
                  >
                    ${targetEntry?.id}
                  </target-link>`,
              )}
            </key-point>`,
        )}
      </div>
    `;
  }

  setupSidePanelClousureListeners() {
    // Notify background when sidepanel is closed
    this._hasNotifiedClosure = false;
    this.handlePageHide = (event) => {
      if (event?.persisted) return;
      this.notifySidepanelClosed();
    };
    window.addEventListener("pagehide", this.handlePageHide);

    this.handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      this.notifySidepanelClosed();
    };
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("pagehide", this.handlePageHide);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  notifySidepanelClosed() {
    if (this._hasNotifiedClosure) return;
    this._hasNotifiedClosure = true;
    chrome.runtime.sendMessage({
      action: "SIDEPANEL_CLOSED",
      tabId: this.tabId,
    });
  }

  async firstUpdated() {
    this.tabId = await this.getActiveTabId();
    await this.initTabStateFromStorage();
    await this.setupStorageListener();
    if (this.targets.length > 0 && this.keyPoints.length === 0) {
      await this.summarizeAndSave();
    }
    this.tabState;
  }

  async initTabStateFromStorage() {
    try {
      const tabIdStr = this.tabId.toString();
      const initialStorageState = await chrome.storage["session"].get(tabIdStr);
      this.tabState = initialStorageState[tabIdStr] || {};
      this.targets = this.tabState.targets || [];
      this.keyPoints = this.tabState.keyPoints || [];
      this.linkedTargets = this.tabState.linkedTargets || [];
    } catch (error) {
      console.error("Failed to initialize storage state:", error);
      this.tabState = {};
    }
  }

  async setupStorageListener() {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      try {
        const tabId = this.tabId.toString();
        const newStorageState = changes?.[tabId]?.newValue;
        if (area !== "session" || !newStorageState) return;

        if (this.hasChanged(this.tabState, newStorageState)) {
          this.tabState = { ...this.tabState, ...newStorageState };
        } else {
          return;
        }

        if (this.hasChanged(this.targets, this.tabState.targets)) {
          this.targets = this.tabState.targets;
          this.keyPoints = [];
          this.linkedTargets = [];
        }
      } catch (error) {
        console.error("Failed to sync storage state:", error);
      }
    });
  }

  hasChanged(a, b) {
    function deepEqual(obj1, obj2) {
      if (obj1 === obj2) return true;
      if (obj1 == null || obj2 == null) return obj1 === obj2;
      if (typeof obj1 !== typeof obj2) return false;
      if (typeof obj1 !== "object") return obj1 === obj2;
      if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      if (keys1.length !== keys2.length) return false;

      for (const key of keys1) {
        if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key]))
          return false;
      }
      return true;
    }
    return !deepEqual(a, b);
  }

  async getActiveTabId() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      return tabs[0].id;
    } catch (error) {
      console.error("Failed to get an active tab on current window :", error);
    }

    throw new Error("Unable to find active tab ID");
  }

  setActivity(state) {
    this.activity = state;

    this.requestUpdate();
  }

  async generateKeyPoints() {
    try {
      if (!(this.targets?.length > 0)) {
        throw new Error("No targets available for summarization");
      }

      this.setActivity(ACTIVITY.CHECKING_AI);
      this.keyPoints = [];
      this.linkedTargets = [];

      const summaryOptions = {
        sharedContext: `
         This is the content from a web page titled "${this.tabState?.docTitle || "untitled"}"
        `,
        type: ["key-points", "tldr", "teaser", "headline"].at(0),
        format: ["markdown", "plain-text"].at(1),
        length: ["short", "medium", "long"].at(2),
        outputLanguage: "en", // TODO: support more languages
      };

      const availability = await Summarizer.availability(summaryOptions);
      let summarizer;
      if (availability === "unavailable") {
        return "Summarizer API is not available";
      }

      this.setActivity(ACTIVITY.PREPARING);
      if (availability === "available") {
        summarizer = await Summarizer.create(summaryOptions);
      } else {
        this.setActivity(ACTIVITY.DOWNLOADING);
        summarizer = await Summarizer.create(summaryOptions);
        summarizer.addEventListener("downloading progress", (e) => {
          console.log(`Downloaded ${e.loaded * 100}%`);
        });
        await summarizer.ready;
      }

      this.setActivity(ACTIVITY.GENERATING);
      const stream = summarizer.summarizeStreaming(
        this.targets.reduce((acc, target) => (acc += target.text), ""),
      );

      await createKeyPointStream(stream, (keyPoints) => {
        this.keyPoints = keyPoints;
      });

      summarizer.destroy();

      return this.keyPoints;
    } catch (e) {
      console.log("Summary generation failed");
      console.error(e);
      return "Error: " + e.message;
    } finally {
      this.setActivity(ACTIVITY.IDLE);
    }
  }

  async linkTargetsToKeyPoints() {
    try {
      this.setActivity(ACTIVITY.LINKING_TARGETS);
      this.linkedTargets = await computeSemanticMatches(
        this.keyPoints,
        this.targets,
      );

      return this.linkedTargets;
    } catch (error) {
      console.error("Failed to map key points to targets:", error);
    } finally {
      this.setActivity(ACTIVITY.IDLE);
    }
  }

  async sendNewContentsRequest() {
    try {
      this.setActivity(ACTIVITY.REQUESTING_CONTENTS);
      await extractContentsFromTab(this.tabId);
      await this.summarizeAndSave();
    } finally {
      this.setActivity(ACTIVITY.IDLE);
    }
  }

  async summarizeAndSave() {
    const tabId = this.tabId;
    const tabIdStr = tabId.toString();
    chrome.action.setBadgeText({ text: BADGE.BUSY, tabId });

    const keyPoints = await this.generateKeyPoints();
    const linkedTargets = await this.linkTargetsToKeyPoints();

    chrome.storage.session.get(tabIdStr, (data) => {
      const storageState = data?.[tabIdStr] || {};
      Object.assign(storageState, { keyPoints, linkedTargets });
      chrome.storage.session.set({ [tabIdStr]: storageState });
    });

    chrome.action.setBadgeText({ text: BADGE.IDLE, tabId });
  }
}

customElements.define("side-panel", Sidepanel);
customElements.define("key-point", KeyPoint);
customElements.define("target-link", TargetLink);
