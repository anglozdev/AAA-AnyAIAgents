// AAA Test Patch - Verified Pull Engine
/*
 * Copyright (C) 2026 Angel Lozano (anglozdev)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "execute_dom_action") {
    try {
      let resultData = "";
      if (request.command === "read_text") {
        const el = (request.selector && request.selector !== "body") ? document.querySelector(request.selector) : document.body;
        if (!el) throw new Error("Selector not found: " + request.selector);
        resultData = el.innerText.substring(0, 15000);
      } else if (request.command === "click") {
        const el = document.querySelector(request.selector);
        if (!el) throw new Error("Selector not found: " + request.selector);
        el.click();
        resultData = "Clicked successfully: " + request.selector;
      } else if (request.command === "extract") {
        const elements = document.querySelectorAll(request.selector);
        if (elements.length === 0) throw new Error("No elements found for: " + request.selector);
        resultData = Array.from(elements).map(e => e.innerText).join('\n---\n').substring(0, 15000);
      } else {
        throw new Error("Unknown command: " + request.command);
      }
      sendResponse({ success: true, data: resultData });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});