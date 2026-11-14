// <<<<=== START: web-worker.js ===>>>>
/*
 * Copyright (C) 2026 Angel Lozano (anglozdev)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
if (!window.__AAA_WEB_WORKER_LOADED__) {
  window.__AAA_WEB_WORKER_LOADED__ = true;
  // --------------------------------------------------------
  // WORKER_QA STATE & CONFIGURATION
  // --------------------------------------------------------
  let qaPanel = null;
  let isQaPanelOpen = false;
  let isQaActive = true;
  let currentWorkspace = localStorage.getItem("aaa_qa_workspace") || "default";
  let currentRole = localStorage.getItem("aaa_qa_role") || "Worker_QA";
  let isPickerActive = false;
  let hoveredElement = null;
  let prevOutline = "";
  const originalTabTitle = document.title;
  // --------------------------------------------------------
  // TAB TITLE & ROUTER REGISTRATION ENGINE
  // --------------------------------------------------------
  function syncQaRegistration() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    if (isQaPanelOpen && currentRole && currentWorkspace) {
      const statusStr = isQaActive ? "active" : "stopped";
      document.title = `${currentRole} - ${currentWorkspace} - ${statusStr}`;
      chrome.runtime.sendMessage({
        action: "register_role",
        role: currentRole,
        workspace: currentWorkspace,
        status: statusStr
      }).catch(() => {});
    } else {
      document.title = originalTabTitle;
      chrome.runtime.sendMessage({
        action: "register_role",
        role: "",
        workspace: currentWorkspace,
        status: "stopped"
      }).catch(() => {});
    }
  }
  // --------------------------------------------------------
  // ODOO & DOM EXTRACTION ENGINE
  // --------------------------------------------------------
  function expandOdooErrorDetails(rootEl) {
    const scope = rootEl || document;
    const toggleBtns = scope.querySelectorAll(
      ".o_error_dialog button, .modal-content button, .o_technical_modal button, details summary"
    );
    toggleBtns.forEach(btn => {
      const txt = (btn.innerText || btn.textContent || "").toLowerCase();
      if (txt.includes("detail") || txt.includes("traceback") || txt.includes("see more")) {
        try { btn.click(); } catch (e) {}
      }
    });
    scope.querySelectorAll(".o_error_dialog .collapse:not(.show), .modal-content .collapse:not(.show)").forEach(col => {
      col.classList.add("show");
      col.style.display = "block";
    });
  }
  // --------------------------------------------------------
  function executeDomCommand(command, selector) {
    const cleanSelector = (selector || "body").trim();
    if (command === "odoo_error") {
      expandOdooErrorDetails(document);
      const modal = document.querySelector(".o_error_dialog, .o_technical_modal .modal-content, .modal-dialog .modal-content");
      if (!modal) throw new Error("No active Odoo error modal (.o_error_dialog / .modal-content) found on page.");
      return modal.innerText.trim().substring(0, 15000);
    }
    if (command === "odoo_logs") {
      const logEl = document.querySelector("#odoo-log, pre, body");
      if (!logEl) throw new Error("No log container found on page.");
      const raw = logEl.innerText.trim();
      return raw.length > 15000 ? raw.substring(raw.length - 15000) : raw;
    }
    if (command === "read_text") {
      if (cleanSelector.includes("o_error_dialog") || cleanSelector.includes("modal")) {
        expandOdooErrorDetails(document);
      }
      const el = cleanSelector !== "body" ? document.querySelector(cleanSelector) : document.body;
      if (!el) throw new Error("Selector not found: " + cleanSelector);
      const text = (el.innerText || el.textContent || "").trim();
      return text.substring(0, 15000);
    }
    if (command === "click") {
      const el = document.querySelector(cleanSelector);
      if (!el) throw new Error("Selector not found: " + cleanSelector);
      el.click();
      return "Clicked successfully: " + cleanSelector;
    }
    if (command === "extract") {
      const elements = document.querySelectorAll(cleanSelector);
      if (elements.length === 0) throw new Error("No elements found for: " + cleanSelector);
      return Array.from(elements).map(e => (e.innerText || e.textContent || "").trim()).filter(Boolean).join("\n---\n").substring(0, 15000);
    }
    throw new Error("Unknown command: " + command);
  }
  // --------------------------------------------------------
  // INTERACTIVE ELEMENT PICKER
  // --------------------------------------------------------
  function computeUniqueSelector(el) {
    if (!el || el.nodeType !== 1) return "body";
    if (el.id) return "#" + CSS.escape(el.id);
    const odooClasses = ["o_error_dialog", "o_form_view", "o_list_view", "o_field_widget", "o_notification", "modal-content"];
    for (const cls of odooClasses) {
      if (el.classList.contains(cls)) return "." + cls;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 4) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      const validClasses = Array.from(cur.classList).filter(c => !c.startsWith("o_animated") && c.length < 32).slice(0, 2);
      if (validClasses.length > 0) {
        sel += "." + validClasses.map(c => CSS.escape(c)).join(".");
      }
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(" > ") || "body";
  }
  // --------------------------------------------------------
  function stopElementPicker() {
    if (!isPickerActive) return;
    isPickerActive = false;
    if (hoveredElement) {
      hoveredElement.style.outline = prevOutline;
      hoveredElement = null;
    }
    document.removeEventListener("mouseover", onPickerMouseOver, true);
    document.removeEventListener("click", onPickerClick, true);
    const pickBtn = document.getElementById("aaa-qa-btn-pick");
    if (pickBtn) {
      pickBtn.textContent = "🎯 Pick DOM";
      pickBtn.style.background = "#383838";
    }
  }
  // --------------------------------------------------------
  function onPickerMouseOver(e) {
    if (!isPickerActive) return;
    if (qaPanel && qaPanel.contains(e.target)) return;
    if (hoveredElement && hoveredElement !== e.target) {
      hoveredElement.style.outline = prevOutline;
    }
    hoveredElement = e.target;
    prevOutline = hoveredElement.style.outline || "";
    hoveredElement.style.outline = "2px solid #ff5252";
  }
  // --------------------------------------------------------
  function onPickerClick(e) {
    if (!isPickerActive) return;
    if (qaPanel && qaPanel.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    stopElementPicker();
    const sel = computeUniqueSelector(target);
    const selInput = document.getElementById("aaa-qa-selector");
    if (selInput) selInput.value = sel;
    runCaptureToPreview("read_text", sel);
  }
  // --------------------------------------------------------
  // FLOATING WORKER_QA PANEL UI
  // --------------------------------------------------------
  function updateQaStatus(msg, isError = false) {
    const st = document.getElementById("aaa-qa-status");
    if (!st) return;
    st.textContent = msg;
    st.style.color = isError ? "#ff8a80" : "#81c784";
  }
  // --------------------------------------------------------
  function runCaptureToPreview(command, overrideSelector = null) {
    const selInput = document.getElementById("aaa-qa-selector");
    const previewEl = document.getElementById("aaa-qa-preview");
    const selector = overrideSelector !== null ? overrideSelector : (selInput ? selInput.value : "body");
    try {
      const output = executeDomCommand(command, selector);
      if (previewEl) previewEl.value = output;
      updateQaStatus(`✅ Captured ${output.length} chars (${command})`);
      return output;
    } catch (err) {
      if (previewEl) previewEl.value = "";
      updateQaStatus(`❌ ${err.message}`, true);
      return null;
    }
  }
  // --------------------------------------------------------
  function refreshWorkspaceList() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ action: "get_active_workspaces" }, (res) => {
      const datalist = document.getElementById("aaa-qa-ws-list");
      const wsInput = document.getElementById("aaa-qa-workspace");
      if (!datalist) return;
      datalist.innerHTML = "";
      if (res && res.success && Array.isArray(res.workspaces)) {
        res.workspaces.forEach(ws => {
          const opt = document.createElement("option");
          opt.value = ws;
          datalist.appendChild(opt);
        });
        if (res.workspaces.length > 0 && (!wsInput.value || wsInput.value === "default")) {
          currentWorkspace = res.workspaces[0];
          wsInput.value = currentWorkspace;
          localStorage.setItem("aaa_qa_workspace", currentWorkspace);
          syncQaRegistration();
        }
      }
    });
  }
  // --------------------------------------------------------
  function buildQaPanel() {
    if (qaPanel) return qaPanel;
    qaPanel = document.createElement("div");
    qaPanel.id = "aaa-worker-qa-panel";
    qaPanel.style.cssText = [
      "position:fixed",
      "top:12px",
      "right:12px",
      "width:360px",
      "max-height:92vh",
      "background:#1e1e1e",
      "color:#ffffff",
      "border:1px solid #0288d1",
      "border-radius:8px",
      "box-shadow:0 8px 30px rgba(0,0,0,0.75)",
      "z-index:2147483646",
      "display:none",
      "flex-direction:column",
      "gap:8px",
      "padding:12px",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "font-size:12px",
      "box-sizing:border-box",
      "overflow-y:auto"
    ].join(";");
    qaPanel.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding-bottom:6px;">',
      '  <div style="font-weight:bold;color:#4fc3f7;font-size:14px;">🛠️ AAA Worker_QA Inspector</div>',
      '  <button id="aaa-qa-close" title="Close QA Panel" style="background:transparent;border:none;color:#aaa;cursor:pointer;font-size:15px;padding:2px 6px;">✖</button>',
      '</div>',
      '<div style="display:flex;gap:6px;align-items:center;">',
      '  <button id="aaa-qa-power" style="flex:1;background:#388e3c;color:#fff;border:none;padding:6px 8px;border-radius:4px;font-weight:bold;cursor:pointer;font-size:11px;">▶️ Worker_QA Active</button>',
      '  <button id="aaa-qa-refresh-ws" title="Sync active workspaces from AI tabs" style="background:#383838;color:#fff;border:1px solid #555;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:11px;">🔄 WS</button>',
      '</div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">',
      '  <div>',
      '    <label style="font-size:10px;color:#aaa;display:block;margin-bottom:2px;">Workspace Name:</label>',
      '    <input type="text" id="aaa-qa-workspace" list="aaa-qa-ws-list" placeholder="e.g. sale_custom" style="width:100%;background:#2c2c2c;color:#fff;border:1px solid #555;padding:5px 6px;border-radius:4px;font-size:11px;box-sizing:border-box;">',
      '    <datalist id="aaa-qa-ws-list"></datalist>',
      '  </div>',
      '  <div>',
      '    <label style="font-size:10px;color:#aaa;display:block;margin-bottom:2px;">Tab Agent Role:</label>',
      '    <select id="aaa-qa-role" style="width:100%;background:#2c2c2c;color:#fff;border:1px solid #555;padding:5px 6px;border-radius:4px;font-size:11px;box-sizing:border-box;">',
      '      <option value="Worker_QA">Worker_QA</option>',
      '      <option value="CRM_Assistant">CRM_Assistant</option>',
      '      <option value="WebWorker">WebWorker</option>',
      '    </select>',
      '  </div>',
      '</div>',
      '<div style="background:#262626;padding:8px;border-radius:6px;border:1px solid #383838;display:flex;flex-direction:column;gap:6px;">',
      '  <div style="font-size:11px;font-weight:bold;color:#ffb74d;">⚡ 1-Click Odoo & Log Presets</div>',
      '  <div style="display:flex;gap:5px;flex-wrap:wrap;">',
      '    <button id="aaa-qa-preset-error" title="Expand details & capture Odoo RPC_ERROR / traceback modal" style="flex:1;background:#d32f2f;color:#fff;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">🐞 Odoo Error</button>',
      '    <button id="aaa-qa-preset-logs" title="Capture tail of /dev-logs or <pre> log output" style="flex:1;background:#0288d1;color:#fff;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">🪵 /dev-logs</button>',
      '    <button id="aaa-qa-btn-pick" title="Click any element on the page to inspect & capture it" style="background:#383838;color:#fff;border:1px solid #555;padding:6px 8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">🎯 Pick DOM</button>',
      '  </div>',
      '  <label style="font-size:10px;color:#aaa;">CSS Selector:</label>',
      '  <input type="text" id="aaa-qa-selector" value=".o_error_dialog, .modal-content" placeholder="CSS Selector (e.g. .o_error_dialog, #odoo-log, body)" style="width:100%;background:#161616;color:#81c784;border:1px solid #555;padding:5px 6px;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;">',
      '  <div style="display:flex;gap:5px;">',
      '    <button id="aaa-qa-cmd-read" style="flex:1;background:#2e7d32;color:#fff;border:none;padding:5px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">📖 Read Text</button>',
      '    <button id="aaa-qa-cmd-extract" style="flex:1;background:#6a1b9a;color:#fff;border:none;padding:5px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">📑 Extract All</button>',
      '    <button id="aaa-qa-cmd-click" style="flex:1;background:#ef6c00;color:#fff;border:none;padding:5px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">👆 Click El</button>',
      '  </div>',
      '</div>',
      '<div style="display:flex;justify-content:space-between;align-items:center;">',
      '  <label style="font-size:11px;font-weight:bold;color:#4fc3f7;">Captured Output Preview (Editable):</label>',
      '  <button id="aaa-qa-copy" style="background:#383838;color:#fff;border:1px solid #555;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;">📋 Copy</button>',
      '</div>',
      '<textarea id="aaa-qa-preview" rows="8" placeholder="Captured Odoo traceback, DOM text, or server logs will appear here..." style="width:100%;background:#111;color:#d4d4d4;border:1px solid #444;border-radius:4px;padding:6px;font-family:Consolas,Monaco,monospace;font-size:11px;resize:vertical;box-sizing:border-box;white-space:pre;"></textarea>',
      '<div style="background:#262626;padding:8px;border-radius:6px;border:1px solid #383838;display:flex;flex-direction:column;gap:6px;">',
      '  <div style="display:flex;gap:6px;align-items:center;">',
      '    <span style="font-size:11px;color:#bbb;white-space:nowrap;">Send to:</span>',
      '    <select id="aaa-qa-target-agent" style="flex:1;background:#2c2c2c;color:#fff;border:1px solid #555;padding:4px 6px;border-radius:4px;font-size:11px;">',
      '      <option value="Worker_FullStack">@Worker_FullStack</option>',
      '      <option value="Orchestrator">@Orchestrator</option>',
      '      <option value="Worker_Frontend">@Worker_Frontend</option>',
      '      <option value="Worker_Database">@Worker_Database</option>',
      '      <option value="Worker_DevOps">@Worker_DevOps</option>',
      '    </select>',
      '  </div>',
      '  <input type="text" id="aaa-qa-note" placeholder="Optional note (e.g. Fix this Odoo upgrade error)" style="width:100%;background:#1a1a1a;color:#fff;border:1px solid #555;padding:5px 6px;border-radius:4px;font-size:11px;box-sizing:border-box;">',
      '  <button id="aaa-qa-send-agent" style="width:100%;background:#0288d1;color:#fff;border:none;padding:8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">📤 Send Capture to AI Agent Tab</button>',
      '</div>',
      '<div id="aaa-qa-status" style="font-size:11px;color:#aaa;text-align:center;word-break:break-word;">Ready on ' + window.location.hostname + '</div>'
    ].join("\n");
    document.body.appendChild(qaPanel);
    const wsInput = document.getElementById("aaa-qa-workspace");
    const roleSelect = document.getElementById("aaa-qa-role");
    wsInput.value = currentWorkspace;
    roleSelect.value = currentRole;
    document.getElementById("aaa-qa-close").addEventListener("click", () => {
      stopElementPicker();
      isQaPanelOpen = false;
      qaPanel.style.display = "none";
      syncQaRegistration();
    });
    const powerBtn = document.getElementById("aaa-qa-power");
    powerBtn.addEventListener("click", () => {
      isQaActive = !isQaActive;
      powerBtn.textContent = isQaActive ? "▶️ Worker_QA Active" : "⏸ Worker_QA Paused";
      powerBtn.style.background = isQaActive ? "#388e3c" : "#d32f2f";
      syncQaRegistration();
    });
    document.getElementById("aaa-qa-refresh-ws").addEventListener("click", refreshWorkspaceList);
    wsInput.addEventListener("input", (e) => {
      currentWorkspace = e.target.value.trim() || "default";
      localStorage.setItem("aaa_qa_workspace", currentWorkspace);
      syncQaRegistration();
    });
    roleSelect.addEventListener("change", (e) => {
      currentRole = e.target.value;
      localStorage.setItem("aaa_qa_role", currentRole);
      syncQaRegistration();
    });
    document.getElementById("aaa-qa-preset-error").addEventListener("click", () => {
      document.getElementById("aaa-qa-selector").value = ".o_error_dialog, .modal-content";
      runCaptureToPreview("odoo_error");
    });
    document.getElementById("aaa-qa-preset-logs").addEventListener("click", () => {
      document.getElementById("aaa-qa-selector").value = "#odoo-log, pre, body";
      runCaptureToPreview("odoo_logs");
    });
    document.getElementById("aaa-qa-btn-pick").addEventListener("click", () => {
      if (isPickerActive) {
        stopElementPicker();
        return;
      }
      isPickerActive = true;
      const pickBtn = document.getElementById("aaa-qa-btn-pick");
      pickBtn.textContent = "🛑 Cancel Pick";
      pickBtn.style.background = "#d32f2f";
      updateQaStatus("Hover and click any element on the page...");
      document.addEventListener("mouseover", onPickerMouseOver, true);
      document.addEventListener("click", onPickerClick, true);
    });
    document.getElementById("aaa-qa-cmd-read").addEventListener("click", () => runCaptureToPreview("read_text"));
    document.getElementById("aaa-qa-cmd-extract").addEventListener("click", () => runCaptureToPreview("extract"));
    document.getElementById("aaa-qa-cmd-click").addEventListener("click", () => runCaptureToPreview("click"));
    document.getElementById("aaa-qa-copy").addEventListener("click", async () => {
      const txt = document.getElementById("aaa-qa-preview").value;
      if (!txt) return;
      await navigator.clipboard.writeText(txt);
      updateQaStatus("📋 Copied preview to clipboard!");
    });
    document.getElementById("aaa-qa-send-agent").addEventListener("click", () => {
      const previewText = document.getElementById("aaa-qa-preview").value.trim();
      const noteText = document.getElementById("aaa-qa-note").value.trim();
      const targetRole = document.getElementById("aaa-qa-target-agent").value;
      if (!previewText && !noteText) {
        updateQaStatus("⚠️ Capture some text or enter a note first.", true);
        return;
      }
      const headerLine = noteText ? `${noteText}\n\n` : "";
      const payload = `${headerLine}[Captured from ${window.location.href}]\n\`\`\`text\n${previewText}\n\`\`\``;
      updateQaStatus(`⏳ Routing to @${targetRole} (${currentWorkspace})...`);
      chrome.runtime.sendMessage({
        action: "route_message",
        workspace: currentWorkspace,
        sourceRole: currentRole || "Worker_QA",
        targetRole: targetRole,
        message: payload
      }, (res) => {
        if (res && res.success) {
          updateQaStatus(`✅ Sent to @${targetRole} in workspace "${currentWorkspace}"!`);
        } else {
          updateQaStatus(`❌ Failed: @${targetRole} offline in workspace "${currentWorkspace}". Check WS name!`, true);
        }
      });
    });
    return qaPanel;
  }
  // --------------------------------------------------------
  // RUNTIME MESSAGE LISTENER (PANEL TOGGLE + AI RPA COMMANDS + DMs)
  // --------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle_qa_panel") {
      buildQaPanel();
      isQaPanelOpen = !isQaPanelOpen;
      qaPanel.style.display = isQaPanelOpen ? "flex" : "none";
      if (isQaPanelOpen) {
        refreshWorkspaceList();
        syncQaRegistration();
      } else {
        stopElementPicker();
        syncQaRegistration();
      }
      sendResponse({ success: true });
      return true;
    }
    if (request.action === "execute_dom_action") {
      try {
        const resultData = executeDomCommand(request.command, request.selector);
        if (qaPanel) {
          const selEl = document.getElementById("aaa-qa-selector");
          const prevEl = document.getElementById("aaa-qa-preview");
          if (selEl && request.selector) selEl.value = request.selector;
          if (prevEl) prevEl.value = resultData;
          updateQaStatus(`🤖 AI RPA executed: ${request.command} (${request.selector || "body"})`);
        }
        sendResponse({ success: true, data: resultData });
      } catch (e) {
        if (qaPanel) updateQaStatus(`❌ AI RPA failed: ${e.message}`, true);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
    if (request.action === "receive_agent_message") {
      buildQaPanel();
      if (!isQaPanelOpen) {
        isQaPanelOpen = true;
        qaPanel.style.display = "flex";
        syncQaRegistration();
      }
      const prevEl = document.getElementById("aaa-qa-preview");
      if (prevEl) prevEl.value = `[DM from @${request.sourceRole}]\n${request.message}`;
      updateQaStatus(`📩 Received message from @${request.sourceRole}`);
      sendResponse({ success: true });
      return true;
    }
    if (request.action === "receive_broadcast") {
      if (qaPanel) updateQaStatus(`📡 Broadcast from @${request.sourceRole}`);
      sendResponse({ role: currentRole || "Worker_QA", status: isQaActive ? "active" : "stopped" });
      return true;
    }
  });
}
// <<<<=== END: web-worker.js ===>>>>