export async function extractContentsFromTab(tabId, retries = 3) {
  try {
    if (retries == 0) throw new Error("Max extraction retries reached");

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "EXTRACT_CONTENTS",
    });

    const { success, ...contents } = response ?? {};
    const tabIdStr = tabId.toString();

    chrome.storage.session.get(tabIdStr, (data) => {
      const storageState = data?.[tabIdStr] || {};
      Object.assign(storageState, contents);
      chrome.storage.session.set({ [tabIdStr]: storageState });
    });
  } catch (error) {
    if (error.message.includes("Could not establish connection")) {
      console.log("Injecting content script");
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["contentScript.js"],
      });

      return await extractContentsFromTab(tabId, retries - 1);
    }
    console.warn("Failed to get contents from tab:", error);
  }
}
