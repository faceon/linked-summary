import { BADGE } from "../common/config.js";
import { extractContentsFromTab } from "../common/extractContents.js";

let isProcessing = false;

chrome.action.onClicked.addListener(async (tab) => {
  if (isProcessing) return; // Prevent multiple clicks during processing
  isProcessing = true;

  if (tab.url.startsWith("chrome://")) return;

  const tabId = tab.id;
  const tabIdStr = tabId.toString();

  chrome.storage.session.get(tabIdStr, async (data) => {
    const storageState = data?.[tabIdStr] || {};
    const sidePanelOpen = !!storageState.sidePanelOpen;

    if (!sidePanelOpen) {
      chrome.action.setBadgeText({ text: BADGE.BUSY, tabId });

      // Open side panel
      chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html" });
      chrome.sidePanel.open({ tabId });

      // Update storage state
      storageState.sidePanelOpen = true;
      chrome.storage.session.set({ [tabIdStr]: storageState });

      // Extract contents and save
      await extractContentsFromTab(tabId);

      // Update badge and reset processing flag
      chrome.action.setBadgeText({ text: BADGE.IDLE, tabId });
      isProcessing = false;
    } else {
      // if not sidePanelOpen, close it
      chrome.sidePanel.close({ tabId });

      // Update storage state
      storageState.sidePanelOpen = false;
      chrome.storage.session.set({ [tabIdStr]: storageState });

      // Update badge and reset processing flag
      chrome.action.setBadgeText({ text: BADGE.IDLE, tabId });
      isProcessing = false;
    }
  });
});

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (message.action === "SIDEPANEL_CLOSED") {
    const tabId = message.tabId;
    const tabIdStr = tabId.toString();

    chrome.storage.session.get(tabIdStr, (data) => {
      const storageState = data?.[tabIdStr] || {};
      storageState.sidePanelOpen = false;
      chrome.storage.session.set({ [tabIdStr]: storageState });
    });

    chrome.action.setBadgeText({ text: BADGE.IDLE, tabId });
  }
});
