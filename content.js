// <<<<=== START: content.js ===>>>>
/*
 * Copyright (C) 2026 Angel Lozano (anglozdev)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
console.log("[AAA Reader] content script loaded");
// --------------------------------------------------------
// GLOBAL STATE & CONFIGURATION VARIABLES
// --------------------------------------------------------
let directoryHandle = null;
let fileHandles = {};
let fileSizes = {};
let isSidebarOpen = false;
let chatObserver = null;
let snippetsFileHandle = null;
let rolesFileHandle = null;
let currentAgentRole = "";
let forcedTabTitle = "";
let consecutiveErrors = 0;
let currentUrlPath = window.location.pathname;
let isSystemActive = false;
let promptsSinceInstructions = 0;
let instructionsEverSent = false;
let latestResponseText = "";
let debounceTimer = null;
const DEFAULT_CLEAN_EXCLUDE = '.git, .env, .json, .md, .gitignore, .csv, .txt, .png, .jpg, .jpeg, .gif, .svg, .ico, .zip, node_modules';
// --------------------------------------------------------
// SAFE DELIMITER CONSTANTS (USING String.fromCharCode(124) FOR TRUE REGEX OR)
// --------------------------------------------------------
const PIPE_CHAR = String.fromCharCode(124);
const OR_OP = String.fromCharCode(124);
const ESC_PIPE = "\\" + String.fromCharCode(124);
const DELIM_OPEN = "<<<<" + "===";
const DELIM_CLOSE = "===" + ">>>>";
const START_MARKER = DELIM_OPEN + " START:";
const END_MARKER = DELIM_OPEN + " END:";
const PATCH_OLD_MARKER = DELIM_OPEN + " PATCH_OLD " + DELIM_CLOSE;
const PATCH_NEW_MARKER = DELIM_OPEN + " PATCH_NEW " + DELIM_CLOSE;
const PATCH_END_MARKER = DELIM_OPEN + " PATCH_END " + DELIM_CLOSE;
const MERGED_PREFIX = "merged_workspace";
// --------------------------------------------------------
function pickFirstTruthy(items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i]) return items[i];
  }
  return null;
}
// --------------------------------------------------------
function isExtensionContextValid() {
  try {
    return Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}
// --------------------------------------------------------
function getAIProvider() {
  const host = window.location.hostname.toLowerCase();
  switch (true) {
    case host.includes('gemini'): return 'gemini';
    case host.includes('chatgpt') ? true : host.includes('openai'): return 'chatgpt';
    case host.includes('claude'): return 'claude';
    case host.includes('perplexity'): return 'perplexity';
    case host.includes('deepseek'): return 'deepseek';
    case host.includes('qwen'): return 'qwen';
    case host.includes('kimi') ? true : host.includes('moonshot'): return 'kimi';
    case host.includes('doubao'): return 'doubao';
    case host.includes('huggingface'): return 'huggingface';
    default: return 'gemini';
  }
}
// --------------------------------------------------------
function isMergedFileName(path) {
  if (!path) return false;
  const base = path.split('/').pop().toLowerCase();
  return base === "merged_workspace.txt" ? true : (base.startsWith(MERGED_PREFIX) && base.endsWith(".txt"));
}
// --------------------------------------------------------
function isInternalMetaFile(path) {
  if (!path) return false;
  return ['anyai_snippets.md', 'anyai_roles.md', 'anyai_activity.csv', '.anyai_session.md', 'file_list.txt'].includes(path) ? true : isMergedFileName(path);
}
// --------------------------------------------------------
function isSpecificSessionUrl(pathname) {
  if (!pathname ? true : pathname === "/") return false;
  const clean = pathname.replace(/\/+$/, "");
  if (["/app", "/chat", "/new", "/u/0/app", "/u/1/app", "/u/2/app"].includes(clean)) return false;
  return clean.split("/").filter(Boolean).length >= 2;
}
// --------------------------------------------------------
function getCommentWrappedDelimiter(actionWord, filePath) {
  const core = `${DELIM_OPEN} ${actionWord}: ${filePath} ${DELIM_CLOSE}`;
  const lower = (filePath ? filePath : "").toLowerCase();
  if (lower.endsWith(".html") ? true : (lower.endsWith(".xml") ? true : lower.endsWith(".md"))) return `<!-- ${core} -->`;
  if (lower.endsWith(".css") ? true : lower.endsWith(".sql")) return `/* ${core} */`;
  if (lower.endsWith(".py") ? true : (lower.endsWith(".sh") ? true : (lower.endsWith(".yaml") ? true : lower.endsWith(".yml")))) return `# ${core}`;
  return `// ${core}`;
}
// --------------------------------------------------------
let autoAgentPrompts = {
  noCode: `⚠️ Missing ${START_MARKER} path ${DELIM_CLOSE} ... ${END_MARKER} path ${DELIM_CLOSE} block. Use required format with zero empty lines.`,
  mismatch: `⚠️ Patch mismatch. Output full file natively inside ${START_MARKER} path ${DELIM_CLOSE} ... ${END_MARKER} path ${DELIM_CLOSE} with no empty blank lines.`
};
// --------------------------------------------------------
const DEFAULT_INSTRUCTIONS_TEXT = [
  "FILE OUTPUT FORMAT & RULES:",
  "1. Output every source file inside its own markdown code block using the exact commented boundary format below (commented according to the file language so the tags are valid syntax in the file):",
  "   - JS/TS/GS/C/Java: // " + START_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " ... // " + END_MARKER + " path/to/filename.ext " + DELIM_CLOSE,
  "   - HTML/XML/MD: <!-- " + START_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " --> ... <!-- " + END_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " -->",
  "   - Python/Sh/YAML: # " + START_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " ... # " + END_MARKER + " path/to/filename.ext " + DELIM_CLOSE,
  "   - CSS/SQL: /* " + START_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " */ ... /* " + END_MARKER + " path/to/filename.ext " + DELIM_CLOSE + " */",
  "2. Both START and END tags must begin at column 0 of a new line, and the filename in START: and END: must match character-for-character.",
  "3. EXISTING FILES (Patches): Inside the file START/END markers, use commented patch tags:",
  "// " + PATCH_OLD_MARKER,
  "exact old lines to replace (MUST MATCH VERBATIM. NO abbreviations or `...`)",
  "// " + PATCH_NEW_MARKER,
  "new lines",
  "// " + PATCH_END_MARKER,
  "4. BRAND NEW FILES (or full replacements): Output the full file content directly between START and END.",
  "5. NO EMPTY CRLF LINES: Do NOT output empty blank lines inside code blocks or patches. Separate functions and logical sections using comment separator lines (e.g. // --------------------------------------------------------).",
  "6. Direct Agent Message: [@AgentName] message",
  "7. Broadcast to All Agents: [BROADCAST] message",
  "8. CRITICAL RULE: If responding to a [BROADCAST] or Rollcall, do NOT generate code blocks or dummy files. Acknowledge receipt with plain text only.",
  "ANSWERS:",
  "- If you are out of memory context for a file, request it by outputting: [REQ:path/file.ext]"
].join("\n");
// --------------------------------------------------------
const DEFAULT_SNIPPETS = [
  "<!-- " + START_MARKER + " anyai_snippets.md " + DELIM_CLOSE + " -->",
  "## Snippets",
  "[Instructions]",
  DEFAULT_INSTRUCTIONS_TEXT,
  "[Refactor] Refactor to be modular/maintainable with zero empty lines (use comment separators).",
  "[Doc] Add JSDoc comments with zero empty lines.",
  "## Orchestration",
  "[Rollcall] 📢 SYSTEM BROADCAST: All agents, please reply with your readiness status. The Orchestrator will assign tasks shortly.",
  "## Auto-Agent",
  "[No Code] " + autoAgentPrompts.noCode,
  "[Mismatch] " + autoAgentPrompts.mismatch,
  "<!-- " + END_MARKER + " anyai_snippets.md " + DELIM_CLOSE + " -->"
].join("\n");
// --------------------------------------------------------
const DEFAULT_ROLES = [
  "<!-- " + START_MARKER + " anyai_roles.md " + DELIM_CLOSE + " -->",
  "## Orchestrator",
  "Role: Lead Orchestrator & Senior Software Analyst. Analyze raw user requests, translate business logic into technical specifications (architecture, edge cases, data flow, and acceptance criteria), break specifications into atomic tasks, and delegate to workers. No coding.",
  "Rule: First, analyze the user request and present a brief Technical Spec & Task Breakdown. Second, assign ONLY one task at a time to the appropriate worker. After receiving task completion from a worker, validate the output against your spec, summarize progress for the human user, and STOP. Do NOT send [@Worker_...] messages or assign new tasks without explicit instructions from the human user.",
  "Format: [@Worker_GAS_Senior] Spec: Sync ERP prices to Sheet 'Master' (Cols A:D) using batch setValues(). Handle empty row edge cases.",
  "## Worker_QA",
  "Role: Quality Assurance & Testing Agent. Verify code, run test suites, and validate UI/API functionality.",
  "Rule: Test ONLY the component or feature specified by the Orchestrator. Report pass/fail status and exact reproduction steps for bugs. Do NOT fix the code yourself or assign fixes directly to other workers.",
  `To run automated UI check: [WEB_CMD: localhost:3000 ${PIPE_CHAR} click ${PIPE_CHAR} #login-submit]`,
  `To verify element text: [WEB_CMD: localhost:3000 ${PIPE_CHAR} read_text ${PIPE_CHAR} .alert-error]`,
  "Format: [@Orchestrator] Tests completed. 2 passed, 1 failed (Auth token timeout on /api/login).",
  "## Worker_Frontend",
  "Role: Frontend Worker. Build UI components, client-side logic, and styling based on Orchestrator tasks.",
  "Rule: Complete assigned tasks only. Consume existing APIs as specified without modifying backend code. Do NOT invent or suggest follow-up work automatically.",
  "Format: [@Orchestrator] Dashboard UI component built and wired to state.",
  "## Worker_Database",
  "Role: Database Administrator & Data Architect. Design schemas, write SQL queries, and manage migrations.",
  "Rule: Execute ONLY the schema changes or queries requested by the Orchestrator. Ensure data integrity and index optimization. Do NOT modify application-level server code.",
  "Format: [@Orchestrator] User_Roles migration script created and indexed.",
  "## Worker_Security",
  "Role: Security & Compliance Auditor. Review code snippets, API endpoints, and configurations for vulnerabilities (OWASP, exposed secrets, auth flaws).",
  "Rule: Audit ONLY the target files or endpoints assigned. Report vulnerabilities by severity (Critical/High/Medium/Low). Do NOT rewrite production code directly.",
  "Format: [@Orchestrator] Security audit complete. 1 High vulnerability found (unsanitized input in search query).",
  "## Worker_DevOps",
  "Role: CI/CD & Infrastructure Agent. Manage Dockerfiles, deployment pipelines, environment configurations, and server health.",
  "Rule: Configure or deploy ONLY what is explicitly instructed. Do NOT trigger production deployments without human confirmation routed through the Orchestrator.",
  "Format: [@Orchestrator] Dockerfile and staging pipeline configured.",
  "## Data_Analyst",
  "Role: Data Processing & Reporting Agent. Clean, transform, and analyze datasets extracted by the Web_Scraper or Database worker.",
  "Rule: Process ONLY the provided dataset and output the requested metrics or structured formats (JSON/CSV). Do NOT initiate new scraping tasks independently.",
  "Format: [@Orchestrator] Q3 pricing data cleaned and aggregated into summary JSON.",
  "## Docs_Writer",
  "Role: Technical Documentation Agent. Write and update READMEs, API specifications (OpenAPI/Swagger), and user guides.",
  "Rule: Document ONLY the features or endpoints specified by the Orchestrator. Keep language concise, accurate, and aligned with current code.",
  "Format: [@Orchestrator] Swagger documentation updated for v2 payment endpoints.",
  "## CRM_Assistant",
  "Role: CRM RPA Agent. Interact with customer relationship platforms (e.g., Salesforce, HubSpot) to log leads, update deal stages, or pull client records.",
  "Rule: Modify or extract ONLY the specific client records instructed by the Orchestrator.",
  `To search contact: [WEB_CMD: crm.com ${PIPE_CHAR} read_text ${PIPE_CHAR} .contact-header]`,
  `To update status: [WEB_CMD: crm.com ${PIPE_CHAR} click ${PIPE_CHAR} #stage-closed-won]`,
  "Format: [@Orchestrator] Lead status updated for Acme Corp.",
  "## Worker_GAS_Senior",
  "Role: Senior Google Apps Script (GAS) Developer & Google Workspace Architect. Build, optimize, and deploy V8 runtime scripts (.gs), Web Apps (doGet/doPost), custom Sheets functions, Workspace Add-ons, and automated triggers across Sheets, Docs, Gmail, Drive, and external APIs (UrlFetchApp).",
  "Rule: Complete assigned tasks only. Enforce GAS best practices: batch read/write operations (getValues/setValues) to prevent 6-minute execution timeouts, use LockService for concurrency, CacheService/PropertiesService for state, and strictly scope OAuth permissions in appsscript.json. Do NOT invent or suggest follow-up work automatically.",
  "To deploy via Clasp: [CLI_CMD: clasp push && clasp deploy]",
  "Format: [@Orchestrator] GAS script built and optimized. Batch processing implemented for Sheet sync and time-driven trigger configured.",
  "## Worker_FullStack",
  "Role: Senior Full-Stack Developer. Write end-to-end application code (Frontend UI, Backend APIs, and Database integration) based on Orchestrator tasks.",
  "Rule: Complete assigned tasks only. Maintain clean architecture, type safety, and modular code. Do NOT invent, request, or suggest follow-up work automatically.",
  "Format: [@Orchestrator] Full-stack feature implemented.",
  "<!-- " + END_MARKER + " anyai_roles.md " + DELIM_CLOSE + " -->"
].join("\n");
// --------------------------------------------------------
// AI MULTI-FILE DELIMITER & REGEX PARSER
// --------------------------------------------------------
function buildCommentPrefixPattern() {
  const commentTokens = ["\\/\\/", "#", "<!--", "\\/\\*", "--", "%"].join(OR_OP);
  return "(?:[ \\t]*(?:" + commentTokens + ")[ \\t]*)?";
}
// --------------------------------------------------------
function buildCommentSuffixPattern() {
  return "[ \\t]*(?:-->" + OR_OP + "\\*\\/)?[ \\t]*";
}
// --------------------------------------------------------
function parseAiFileBlocks(rawText, stripAccidentalFences = true) {
  const files = {};
  const incomplete = [];
  if (!rawText ? true : typeof rawText !== 'string') {
    return { files: files, incomplete: incomplete, hasErrors: false };
  }
  const normalizedText = rawText.replace(/\r\n/g, '\n');
  const commentPrefix = buildCommentPrefixPattern();
  const commentSuffix = buildCommentSuffixPattern();
  const completePattern = "^" + commentPrefix + DELIM_OPEN + "\\s*START:\\s*([^\\n]+?)\\s*" + DELIM_CLOSE + commentSuffix + "\\n([\\s\\S]*?)^" + commentPrefix + DELIM_OPEN + "\\s*END:\\s*\\1\\s*" + DELIM_CLOSE + commentSuffix;
  const completeRegex = new RegExp(completePattern, "gm");
  let match;
  while ((match = completeRegex.exec(normalizedText)) !== null) {
    const fileName = match[1].trim();
    if (!isValidTargetFilename(fileName)) continue;
    let content = match[2];
    if (stripAccidentalFences) {
      content = content.replace(/^```[\w-]*[ \t]*\n/, '').replace(/\n```[ \t]*\n?$/, '\n');
    }
    content = content.replace(/\n$/, '');
    if (Object.prototype.hasOwnProperty.call(files, fileName)) {
      files[fileName] = files[fileName] + "\n" + content;
    } else {
      files[fileName] = content;
    }
  }
  const startPattern = "^" + commentPrefix + DELIM_OPEN + "\\s*START:\\s*([^\\n]+?)\\s*" + DELIM_CLOSE + commentSuffix + "$";
  const startRegex = new RegExp(startPattern, "gm");
  let startMatch;
  while ((startMatch = startRegex.exec(normalizedText)) !== null) {
    const openedFile = startMatch[1].trim();
    if (!isValidTargetFilename(openedFile)) continue;
    if (!Object.prototype.hasOwnProperty.call(files, openedFile)) {
      if (!incomplete.includes(openedFile)) incomplete.push(openedFile);
    }
  }
  return { files: files, incomplete: incomplete, hasErrors: incomplete.length > 0 };
}
// --------------------------------------------------------
// PROMPT PLACEHOLDER REMINDER ENGINE
// --------------------------------------------------------
function loadPromptTrackingState() {
  const savedEver = localStorage.getItem('cb-inst-ever-' + window.location.pathname);
  const savedCount = localStorage.getItem('cb-inst-count-' + window.location.pathname);
  instructionsEverSent = savedEver === 'true';
  promptsSinceInstructions = savedCount ? parseInt(savedCount, 10) : 0;
  updatePromptPlaceholder();
}
// --------------------------------------------------------
function savePromptTrackingState() {
  localStorage.setItem('cb-inst-ever-' + window.location.pathname, instructionsEverSent ? 'true' : 'false');
  localStorage.setItem('cb-inst-count-' + window.location.pathname, String(promptsSinceInstructions));
  updatePromptPlaceholder();
}
// --------------------------------------------------------
function updatePromptPlaceholder() {
  const promptEl = document.getElementById('cb-prompt');
  if (!promptEl) return;
  if (!instructionsEverSent) {
    promptEl.placeholder = "⚠️ Note: System instructions have never been sent in this session. Load [Instructions] from Snippets!\nWhat should the AI do?";
  } else if (promptsSinceInstructions >= 10) {
    promptEl.placeholder = "🔔 Reminder: " + promptsSinceInstructions + " prompts since instructions were sent. Consider loading [Instructions] from Snippets!\nWhat should the AI do?";
  } else {
    promptEl.placeholder = "What should the AI do?";
  }
}
// --------------------------------------------------------
// TELEMETRY & CSV LOGGING ENGINE
// --------------------------------------------------------
let logQueue = Promise.resolve();
async function logAndTrackFile(action, filePath) {
  if (!directoryHandle) return;
  logQueue = logQueue.then(async () => {
    const time = new Date().toISOString();
    const role = currentAgentRole ? currentAgentRole : "User/System";
    const url = window.location.href;
    try {
      const csvHandle = await directoryHandle.getFileHandle('anyai_activity.csv', { create: true });
      fileHandles['anyai_activity.csv'] = csvHandle;
      const file = await csvHandle.getFile();
      let csvContent = await file.text();
      if (!csvContent.startsWith("Datetime")) csvContent = "Datetime,Agent Role,URL,Filename,Action\n";
      csvContent += `"${time}","${role}","${url}","${filePath}","${action}"\n`;
      const writable = await csvHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
    } catch (e) {}
  }).catch(() => {});
  return logQueue;
}
// --------------------------------------------------------
// DYNAMIC TAB TITLE ENGINE
// --------------------------------------------------------
function updateTabTitle() {
  if (currentAgentRole && directoryHandle) {
    const statusStr = isSystemActive ? "active" : "stopped";
    forcedTabTitle = `${currentAgentRole} - ${directoryHandle.name} - ${statusStr}`;
    document.title = forcedTabTitle;
  } else {
    forcedTabTitle = "";
  }
}
// --------------------------------------------------------
// INDEXED DB & STRICT SESSION-URL TO WORKSPACE MAPPING
// --------------------------------------------------------
async function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AnyAIAgentsDB', 1);
    request.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}
// --------------------------------------------------------
async function saveDirectoryHandle(handle) {
  try {
    const db = await getDB();
    db.transaction('handles', 'readwrite').objectStore('handles').put(handle, handle.name);
    if (isSpecificSessionUrl(window.location.pathname)) {
      localStorage.setItem('cb-workspace-url-' + window.location.pathname, handle.name);
    }
  } catch (e) {}
}
// --------------------------------------------------------
async function loadDirectoryHandle() {
  try {
    if (!isSpecificSessionUrl(window.location.pathname)) return null;
    const targetName = localStorage.setItem ? localStorage.getItem('cb-workspace-url-' + window.location.pathname) : null;
    if (!targetName) return null;
    const db = await getDB();
    return new Promise((resolve) => {
      const req = db.transaction('handles', 'readonly').objectStore('handles').get(targetName);
      req.onsuccess = () => resolve(req.result ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}
// --------------------------------------------------------
// UI INJECTION
// --------------------------------------------------------
const sidebar = document.createElement('div');
sidebar.id = 'codebridge-sidebar';
sidebar.style.display = 'none';
sidebar.innerHTML = [
  '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">',
  '  <h3 style="margin: 0; color: #4fc3f7;">AnyAIAgents (AAA)</h3>',
  '  <button id="cb-btn-close" title="Hide Panel">✖</button>',
  '</div>',
  '<button id="cb-btn-power" style="width: 100%; background-color: #d32f2f; color: white; border: none; padding: 8px; margin-bottom: 6px; border-radius: 4px; font-weight: bold; cursor: pointer;">⏸ System Stopped</button>',
  '<select id="cb-role-select" disabled title="Select workspace first" style="cursor: not-allowed; color: #aaa; margin-bottom: 6px;">',
  '  <option value="">-- Set Agent Role --</option>',
  '</select>',
  '<div style="display: flex; gap: 5px; margin: 4px 0; align-items: stretch;">',
  '  <button id="cb-btn-folder" style="flex: 1; margin: 0 !important;">1. Select Workspace/Folder</button>',
  '  <button id="cb-btn-sessions" disabled title="View & recover saved workspace sessions across all AIs" style="background: #00897b; padding: 6px 10px !important; margin: 0 !important; font-size: 11px !important; white-space: nowrap;">🕒 Sessions</button>',
  '</div>',
  '<div style="display: flex; justify-content: space-between; align-items: center; background: #252525; padding: 5px 10px; margin-top: 6px; border-radius: 4px 4px 0 0; border-bottom: 1px solid #444;">',
  '  <span style="font-size: 11px; font-weight: bold; color: #bbb;">Workspace Files (Click name for actions)</span>',
  '  <label style="font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; margin: 0;"><input type="checkbox" id="cb-select-all" checked style="cursor: pointer; margin: 0;"> All</label>',
  '</div>',
  '<div class="file-list" id="cb-file-list" style="margin-top: 0; border-radius: 0 0 4px 4px; max-height: 220px; overflow-y: auto; overflow-x: hidden;">No workspace/folder selected</div>',
  '<div style="display: flex; gap: 5px; margin-bottom: 5px;">',
  '  <button id="cb-btn-merge-save" disabled style="flex: 1; font-size: 11px; padding: 6px; background: #0288d1;" title="Filter file types and merge into a datestamped file">📦 Merge to File</button>',
  '  <button id="cb-btn-merge-paste" disabled style="flex: 1; font-size: 11px; padding: 6px; background: #7b1fa2;" title="Filter file types, merge, and attach into chat">📋 Attach Merged</button>',
  '</div>',
  '<select id="cb-snippet-select" style="width: 100%; margin-top: 4px;">',
  '  <option value="">-- Load Snippet --</option>',
  '</select>',
  '<label style="font-size: 12px; font-weight: bold; margin-top: 5px; display: block;">Prompt:</label>',
  '<textarea id="cb-prompt" rows="3" placeholder="What should the AI do?"></textarea>',
  '<div style="display: flex; align-items: center; margin: 5px 0; justify-content: space-between; gap: 4px; flex-wrap: wrap;">',
  '  <label style="font-size: 11px; cursor: pointer; color: #4fc3f7; display: flex; align-items: center; gap: 3px;"><input type="checkbox" id="cb-map-toggle" checked style="width: auto; margin: 0; cursor: pointer;"> Attach Project Map</label>',
  '  <label style="font-size: 11px; font-weight: bold; cursor: pointer; color: #b39ddb; display: flex; align-items: center; gap: 3px;"><input type="checkbox" id="cb-broadcast-toggle" style="width: auto; margin: 0; cursor: pointer;"> 📡 Broadcast</label>',
  '  <label style="font-size: 11px; cursor: pointer; color: #ffca28; display: flex; align-items: center; gap: 3px;"><input type="checkbox" id="cb-agent-toggle" checked style="width: auto; margin: 0; cursor: pointer;"> 🤖 Auto-Agent</label>',
  '</div>',
  '<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">',
  '  <button id="cb-btn-send" style="flex: 1;">2. Send Prompt / Attachments</button>',
  '  <label style="font-size: 11px; cursor: pointer; white-space: nowrap;"><input type="checkbox" id="cb-auto-answer" checked> Auto-Answer</label>',
  '</div>',
  '<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">',
  '  <button id="cb-btn-pull" disabled style="flex: 1;">3. Pull AI Output & Save</button>',
  '  <label style="font-size: 11px; cursor: pointer; white-space: nowrap;"><input type="checkbox" id="cb-auto-pull"> Auto-Pull</label>',
  '</div>',
  '<textarea id="cb-manual-pull-input" rows="2" placeholder="Optional: Paste raw code/patches here to decode manually instead of pulling from chat..." style="font-size: 11px; margin-top: 4px;"></textarea>',
  '<hr style="width:100%; border-color:#555; margin: 10px 0;">',
  '<details style="margin-bottom: 8px; background: #2a2a2a; padding: 5px; border-radius: 4px;">',
  '  <summary style="cursor:pointer; font-size: 13px; font-weight: bold;">☁ Google Apps Script</summary>',
  '  <div style="margin-top: 8px; font-size: 12px;">',
  '    <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 4px;">',
  '      <input type="password" id="cb-gas-client-id" placeholder="Google OAuth Client ID (...apps.googleusercontent.com)" style="flex: 1; margin: 0 !important;">',
  '      <button id="cb-btn-gas-manual" title="How to get your Google OAuth Client ID" style="background: #0288d1; font-size: 11px !important; padding: 6px 8px !important; margin: 0 !important; white-space: nowrap;">❓ Guide</button>',
  '    </div>',
  '    <input type="text" id="cb-script-id" placeholder="Script ID (linked to workspace)">',
  '    <div style="display: flex; gap: 5px; margin-bottom: 5px;">',
  '      <button id="cb-btn-pull-gas" style="flex: 1; font-size: 11px; padding: 6px;">⬇ Pull GAS</button>',
  '      <button id="cb-btn-push-gas" style="flex: 1; font-size: 11px; padding: 6px;">⬆️ Push GAS</button>',
  '    </div>',
  '    <div style="display: flex; align-items: center;">',
  '      <input type="checkbox" id="cb-autopush-toggle" checked style="width: auto; margin: 0 5px 0 0;">',
  '      <label for="cb-autopush-toggle" style="color: #a5d6a7;">Auto-Push on AI Pull</label>',
  '    </div>',
  '  </div>',
  '</details>',
  '<details style="margin-bottom: 8px; background: #2a2a2a; padding: 5px; border-radius: 4px;">',
  '  <summary style="cursor:pointer; font-size: 13px; font-weight: bold;">🐙 GitHub Sync</summary>',
  '  <div style="margin-top: 8px; font-size: 12px;">',
  '    <input type="password" id="cb-git-token" placeholder="GitHub PAT (ghp_...)">',
  '    <div style="display: flex; gap: 5px; margin-bottom: 5px;">',
  '      <select id="cb-git-repo" style="flex: 1;"><option value="">-- Select Repo --</option><option value="__CREATE__">➕ Create New...</option></select>',
  '      <button id="cb-btn-fetch-repos" style="font-size: 11px; padding: 6px;">🔄</button>',
  '    </div>',
  '    <div style="display: flex; gap: 5px; margin-bottom: 5px;">',
  '      <select id="cb-git-branch" style="flex: 1;"><option value="main">main</option></select>',
  '      <button id="cb-btn-new-branch" style="font-size: 11px; padding: 6px;" title="Create new branch">➕</button>',
  '    </div>',
  '    <input type="text" id="cb-git-commit-msg" placeholder="Commit message..." value="AAA Update">',
  '    <div style="display: flex; gap: 5px;">',
  '      <button id="cb-btn-pull-git" style="flex: 1; font-size: 11px; padding: 6px;">⬇️ Pull Repo</button>',
  '      <button id="cb-btn-push-git" style="flex: 1; font-size: 11px; padding: 6px;">⬆️ Push Commit</button>',
  '    </div>',
  '  </div>',
  '</details>',
  '<details style="margin-bottom: 8px; background: #2a2a2a; padding: 5px; border-radius: 4px;">',
  '  <summary style="cursor:pointer; font-size: 13px; font-weight: bold;">⚙ Advanced Settings</summary>',
  '  <div style="margin-top: 8px; font-size: 12px;">',
  '    <label>Exclude (comma-separated):</label>',
  `    <input type="text" id="cb-file-filter" value="${DEFAULT_CLEAN_EXCLUDE}">`,
  '    <label>Regex Scripts (Find/Replace):</label>',
  '    <textarea id="cb-regex" rows="2" placeholder="console.log.*"></textarea>',
  '    <div style="display: flex; align-items: center; margin: 5px 0;"><input type="checkbox" id="cb-diff-toggle" style="width: auto; margin: 0 5px 0 0;"><label for="cb-diff-toggle" style="color: #ffb74d;">Preview Diff before saving</label></div>',
  '    <div style="display: flex; align-items: center; margin: 5px 0;"><input type="checkbox" id="cb-backup-toggle" checked style="width: auto; margin: 0 5px 0 0;"><label for="cb-backup-toggle">Backup full files</label></div>',
  '    <div style="display: flex; align-items: center;"><input type="checkbox" id="cb-patch-toggle" style="width: auto; margin: 0 5px 0 0;"><label for="cb-patch-toggle">Create Git .patch</label></div>',
  '  </div>',
  '</details>',
  '<div id="cb-status" style="margin-top:10px; font-size:12px; color:#aaa; text-align: center;">System loaded.</div>'
].join("\n");
document.body.appendChild(sidebar);
loadPromptTrackingState();
// --------------------------------------------------------
// DIFF MODAL & MERGE FILTER POPUP UI
// --------------------------------------------------------
const diffModal = document.createElement('div');
diffModal.id = 'cb-diff-modal';
diffModal.style.cssText = 'display:none; position:fixed; top:5%; left:10%; width:80%; height:90%; background:#1e1e1e; border:2px solid #444; z-index:999999; padding:20px; color:white; overflow:hidden; flex-direction:column; box-shadow: 0 10px 30px rgba(0,0,0,0.8); border-radius: 8px;';
diffModal.innerHTML = [
  '<h2 style="margin:0 0 10px 0; color:#4fc3f7;">Review Changes</h2>',
  '<textarea id="cb-diff-content" readonly style="flex:1; background:#000; color:#d4d4d4; font-family:monospace; padding:10px; border:1px solid #555; white-space:pre; overflow:auto; font-size:13px;"></textarea>',
  '<div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">',
  '  <button id="cb-btn-cancel-diff" style="background:#d32f2f; padding:8px 16px; border:none; color:white; cursor:pointer; border-radius:4px;">Cancel</button>',
  '  <button id="cb-btn-confirm-diff" style="background:#388e3c; padding:8px 16px; border:none; color:white; cursor:pointer; border-radius:4px;">Accept & Save</button>',
  '</div>'
].join("\n");
document.body.appendChild(diffModal);
// --------------------------------------------------------
const mergeModal = document.createElement('div');
mergeModal.id = 'cb-merge-modal';
mergeModal.style.cssText = 'display:none; position:fixed; top:20%; left:50%; transform:translateX(-50%); width:340px; background:#1e1e1e; border:2px solid #4fc3f7; z-index:1000000; padding:16px; color:white; flex-direction:column; box-shadow: 0 10px 30px rgba(0,0,0,0.85); border-radius: 8px; font-family: sans-serif;';
mergeModal.innerHTML = [
  '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">',
  '  <h4 style="margin:0; color:#4fc3f7;">📦 Merge Workspace Files</h4>',
  '  <button id="cb-btn-close-merge" style="background:transparent; border:none; color:#aaa; cursor:pointer; font-size:16px;">✖</button>',
  '</div>',
  '<label style="font-size:12px; font-weight:bold; margin-bottom:4px;">Filter File Types to Include:</label>',
  '<div id="cb-merge-ext-list" style="max-height:130px; overflow-y:auto; background:#2a2a2a; padding:8px; border-radius:4px; margin-bottom:10px; display:flex; flex-wrap:wrap; gap:8px; font-size:12px;"></div>',
  '<label style="font-size:12px; font-weight:bold; margin-bottom:4px;">Output Merge Filename:</label>',
  '<input type="text" id="cb-merge-filename" style="width:100%; background:#333; color:white; border:1px solid #555; padding:6px; border-radius:4px; box-sizing:border-box; margin-bottom:12px; font-size:12px;">',
  '<div style="display:flex; justify-content:flex-end; gap:8px;">',
  '  <button id="cb-btn-cancel-merge" style="background:#555; padding:6px 12px; border:none; color:white; cursor:pointer; border-radius:4px; font-size:12px;">Cancel</button>',
  '  <button id="cb-btn-exec-merge" style="background:#0288d1; padding:6px 14px; border:none; color:white; cursor:pointer; border-radius:4px; font-weight:bold; font-size:12px;">Merge Now</button>',
  '</div>'
].join("\n");
document.body.appendChild(mergeModal);
// --------------------------------------------------------
const sessionsModal = document.createElement('div');
sessionsModal.id = 'cb-sessions-modal';
sessionsModal.style.cssText = 'display:none; position:fixed; top:12%; left:50%; transform:translateX(-50%); width:520px; max-width:94vw; max-height:78vh; background:#1e1e1e; border:2px solid #00897b; z-index:2147483645; padding:16px; color:white; flex-direction:column; box-shadow: 0 10px 30px rgba(0,0,0,0.85); border-radius: 8px;';
sessionsModal.innerHTML = [
  '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:8px;">',
  '  <h4 style="margin:0; color:#4db6ac; font-size:14px !important;">🕒 Saved Workspace Sessions (.anyai_session.md)</h4>',
  '  <button id="cb-btn-close-sessions" style="background:transparent; border:none; color:#aaa; cursor:pointer; font-size:16px;">✖</button>',
  '</div>',
  '<div style="font-size:11px; color:#aaa; margin-bottom:8px;">Click <b>⚡ Load Here</b> to force this tab to open that session URL, or <b>↗ New Tab</b> to launch it separately.</div>',
  '<div id="cb-sessions-list" style="flex:1; overflow-y:auto; background:#252525; padding:8px; border-radius:4px; display:flex; flex-direction:column; gap:6px; min-height:120px;"></div>',
  '<div style="display:flex; justify-content:flex-end; margin-top:10px;">',
  '  <button id="cb-btn-cancel-sessions" style="background:#555; padding:6px 14px; border:none; color:white; cursor:pointer; border-radius:4px; font-size:12px;">Close</button>',
  '</div>'
].join("\n");
document.body.appendChild(sessionsModal);
// --------------------------------------------------------
// UI ELEMENT REFERENCES
// --------------------------------------------------------
const btnPower = document.getElementById('cb-btn-power');
const btnClose = document.getElementById('cb-btn-close');
const btnFolder = document.getElementById('cb-btn-folder');
const btnSessions = document.getElementById('cb-btn-sessions');
const fileList = document.getElementById('cb-file-list');
const btnMergeSave = document.getElementById('cb-btn-merge-save');
const btnMergePaste = document.getElementById('cb-btn-merge-paste');
const btnSend = document.getElementById('cb-btn-send');
const btnPull = document.getElementById('cb-btn-pull');
const statusDiv = document.getElementById('cb-status');
const selectAllToggle = document.getElementById('cb-select-all');
const snippetSelect = document.getElementById('cb-snippet-select');
const roleSelect = document.getElementById('cb-role-select');
const repoSelect = document.getElementById('cb-git-repo');
const branchSelect = document.getElementById('cb-git-branch');
// --------------------------------------------------------
// CLEAN-CODE EXCLUDE FILTER & FILE_LIST.TXT SYNC ENGINE
// --------------------------------------------------------
function parseExcludePatterns() {
  const el = document.getElementById('cb-file-filter');
  const raw = el ? el.value : DEFAULT_CLEAN_EXCLUDE;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
// --------------------------------------------------------
function shouldExcludePath(filePath, patterns = parseExcludePatterns()) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const parts = norm.split('/');
  const fileName = parts[parts.length - 1];
  for (let pat of patterns) {
    if (pat.startsWith('*.')) pat = pat.slice(1);
    if (pat.startsWith('.')) {
      if (fileName === pat || fileName.endsWith(pat) || parts.includes(pat)) return true;
    } else {
      if (fileName === pat || parts.includes(pat) || norm.includes(pat)) return true;
    }
  }
  return false;
}
// --------------------------------------------------------
async function applyLiveWorkspaceFilter(syncDiskFileList = false) {
  const patterns = parseExcludePatterns();
  let visibleCount = 0;
  const items = fileList.querySelectorAll('.file-item');
  items.forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    const p = row.getAttribute('data-cb-filepath') || (cb ? cb.value : '');
    if (!p) return;
    row.setAttribute('data-cb-filepath', p);
    const excluded = shouldExcludePath(p, patterns);
    row.style.display = excluded ? 'none' : '';
    if (excluded && cb) {
      cb.checked = false;
    } else if (!excluded) {
      visibleCount++;
    }
  });
  if (directoryHandle) {
    statusDiv.textContent = `Showing ${visibleCount} clean source file(s) in ${directoryHandle.name}.`;
  }
  if (syncDiskFileList && directoryHandle && fileHandles) {
    try {
      const allFiltered = Object.keys(fileHandles)
        .filter(p => p !== 'file_list.txt' && !isInternalMetaFile(p) && !shouldExcludePath(p, patterns))
        .sort();
      const fh = await directoryHandle.getFileHandle('file_list.txt', { create: true });
      fileHandles['file_list.txt'] = fh;
      const writable = await fh.createWritable();
      await writable.write(allFiltered.join('\n'));
      await writable.close();
    } catch (e) {}
  }
}
// --------------------------------------------------------
// FLOATING FILE ACTION POPOVER MENU & VIEWER MODAL
// --------------------------------------------------------
function showCbToast(msg) {
  let toast = document.getElementById('cb-quick-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cb-quick-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0288d1;color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:bold;z-index:2147483647;box-shadow:0 4px 14px rgba(0,0,0,0.5);transition:opacity 0.2s;font-family:sans-serif;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}
// --------------------------------------------------------
function formatCodeWithNumbersAndHighlight(rawText) {
  const esc = (rawText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tokenRx = new RegExp([
    "(\\/\\*[\\s\\S]*?\\*\\/)",
    "(\\/\\/[^\\n]*|#[^\\n]*|&lt;!--[\\s\\S]*?--&gt;)",
    "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
    "\\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|async|await|try|catch|finally|throw|new|class|extends|import|export|from|default|typeof|instanceof|true|false|null|undefined)\\b",
    "\\b(\\d+(?:\\.\\d+)?)\\b"
  ].join(OR_OP), "g");
  const highlighted = esc.replace(tokenRx, (m, cMulti, cSingle, str, kw, num) => {
    if (cMulti || cSingle) return `<span style="color:#6a9955;font-style:italic;">${m}</span>`;
    if (str) return `<span style="color:#ce9178;">${m}</span>`;
    if (kw) return `<span style="color:#569cd6;font-weight:bold;">${m}</span>`;
    if (num) return `<span style="color:#b5cea8;">${m}</span>`;
    return m;
  });
  return highlighted.split('\n').map((line, idx) =>
    `<div style="display:flex;line-height:1.5;"><span style="width:42px;flex-shrink:0;color:#666;user-select:none;text-align:right;padding-right:12px;border-right:1px solid #2a2a2a;margin-right:12px;">${idx + 1}</span><span style="white-space:pre;">${line || ' '}</span></div>`
  ).join('');
}
// --------------------------------------------------------
function showFilePreviewModal(filePath, fileObj, isImage, textContent) {
  const existing = document.getElementById('cb-file-preview-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cb-file-preview-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  let bodyHtml = '';
  let blobUrl = null;
  if (isImage && fileObj) {
    blobUrl = URL.createObjectURL(fileObj);
    bodyHtml = `<div style="text-align:center;padding:16px;overflow:auto;max-height:72vh;max-width:100%;"><img src="${blobUrl}" style="border-radius:6px;border:1px solid #333;" /></div>`;
  } else {
    const formattedHtml = formatCodeWithNumbersAndHighlight(textContent);
    bodyHtml = `<div style="background:#111;color:#d4d4d4;padding:12px;border-radius:6px;border:1px solid #333;overflow-x:auto;overflow-y:auto;max-height:72vh;max-width:100%;font-size:12px;font-family:Consolas,Monaco,'Courier New',monospace;margin:0;">${formattedHtml}</div>`;
  }
  overlay.innerHTML = `
    <div style="background:#1a1a1a;color:#e0e0e0;width:760px;max-width:94vw;max-height:90vh;border-radius:10px;border:1px solid #444;padding:18px 22px;box-shadow:0 12px 45px rgba(0,0,0,0.85);display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding-bottom:10px;">
        <div style="font-weight:bold;color:#4fc3f7;font-size:14px;word-break:break-all;">📄 ${filePath}</div>
        <button id="cb-close-file-preview" style="background:#d32f2f;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">✕ Close</button>
      </div>
      ${bodyHtml}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.id === 'cb-close-file-preview') {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      overlay.remove();
    }
  });
}
// --------------------------------------------------------
function showFileActionMenu(filePath, anchorX, anchorY) {
  const existing = document.getElementById('cb-file-action-menu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'cb-file-action-menu';
  const left = Math.min(anchorX, window.innerWidth - 230);
  const top = Math.min(anchorY, window.innerHeight - 190);
  menu.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:215px;background:#1e1e1e;color:#e0e0e0;border:1px solid #0288d1;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,0.75);z-index:2147483647;padding:6px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;`;
  const btnStyle = 'display:block;width:100%;text-align:left;background:transparent;color:#e0e0e0;border:none;padding:7px 10px;border-radius:5px;cursor:pointer;font-size:12px;';
  menu.innerHTML = `
    <div style="padding:5px 8px;font-size:11px;color:#4fc3f7;font-weight:bold;border-bottom:1px solid #333;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${filePath}">${filePath}</div>
    <button data-act="copy-path" style="${btnStyle}">📋 Copy File Path</button>
    <button data-act="copy-content" style="${btnStyle}">📄 Copy File Content</button>
    <button data-act="preview-modal" style="${btnStyle}">🔍 Preview in Modal</button>
    <button data-act="open-tab" style="${btnStyle}">↗️ Open in New Browser Tab</button>
  `;
  document.body.appendChild(menu);
  menu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', () => { btn.style.background = '#2c2c2c'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.getAttribute('data-act');
      menu.remove();
      const rootName = (directoryHandle && directoryHandle.name) ? directoryHandle.name + '/' : '';
      const fullRelativePath = rootName + filePath;
      if (act === 'copy-path') {
        await navigator.clipboard.writeText(fullRelativePath);
        showCbToast(`✅ Copied path: ${fullRelativePath}`);
        return;
      }
      const handle = fileHandles ? fileHandles[filePath] : null;
      if (!handle) {
        showCbToast('⚠️ File handle not found in local workspace.');
        return;
      }
      try {
        const fileObj = await handle.getFile();
        const lower = filePath.toLowerCase();
        const isImg = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp)$/.test(lower);
        if (act === 'copy-content') {
          if (isImg) {
            await navigator.clipboard.writeText(fullRelativePath);
            showCbToast('ℹ️ Binary image — copied file path instead.');
          } else {
            const txt = await fileObj.text();
            await navigator.clipboard.writeText(txt);
            showCbToast(`✅ Copied content of ${filePath}`);
          }
        } else if (act === 'preview-modal') {
          const txt = isImg ? '' : await fileObj.text();
          showFilePreviewModal(filePath, fileObj, isImg, txt);
        } else if (act === 'open-tab') {
          if (isImg) {
            const blobUrl = URL.createObjectURL(fileObj);
            window.open(blobUrl, '_blank');
          } else {
            const txt = await fileObj.text();
            const formattedHtml = formatCodeWithNumbersAndHighlight(txt);
            const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filePath}</title><style>body{margin:0;background:#121212;color:#d4d4d4;font-family:Consolas,Monaco,'Courier New',monospace;font-size:13px;} .hdr{position:sticky;top:0;background:#1e1e1e;color:#4fc3f7;padding:10px 18px;font-family:sans-serif;font-weight:bold;border-bottom:1px solid #333;} .code{padding:14px;overflow-x:auto;}</style></head><body><div class="hdr">📄 ${filePath}</div><div class="code">${formattedHtml}</div></body></html>`;
            const htmlBlob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
            window.open(URL.createObjectURL(htmlBlob), '_blank');
          }
        }
      } catch (err) {
        showCbToast(`❌ Error reading file: ${err.message}`);
      }
    });
  });
  setTimeout(() => {
    const closeListener = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeListener, true);
      }
    };
    document.addEventListener('click', closeListener, true);
  }, 50);
}
// --------------------------------------------------------
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') return;
  const row = e.target.closest('.file-item');
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]');
  const filePath = row.getAttribute('data-cb-filepath') || (cb ? cb.value : null);
  if (!filePath || filePath === 'on') return;
  e.preventDefault();
  e.stopPropagation();
  showFileActionMenu(filePath, e.clientX, e.clientY);
}, true);
// --------------------------------------------------------
// MERGE WORKSPACE CODE FILES ENGINE (WITH POPUP & DATESTAMP)
// --------------------------------------------------------
let pendingMergeAttachMode = false;
function getDatestampedMergeFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ds = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `${MERGED_PREFIX}_${ds}.txt`;
}
// --------------------------------------------------------
function openMergePopup(attachAfterSave) {
  if (!directoryHandle) {
    statusDiv.textContent = "❌ Select a workspace/folder first.";
    return;
  }
  pendingMergeAttachMode = attachAfterSave;
  const checkedInputs = Array.from(fileList.querySelectorAll('.file-item input[type="checkbox"]:checked'));
  const candidatePaths = checkedInputs.map(cb => cb.value).filter(p => p && !isInternalMetaFile(p));
  if (candidatePaths.length === 0) {
    statusDiv.textContent = "⚠️ No code files checked in the file list.";
    return;
  }
  const extCounts = {};
  candidatePaths.forEach(p => {
    const base = p.split('/').pop();
    const dotIdx = base.lastIndexOf('.');
    const ext = dotIdx !== -1 ? base.substring(dotIdx).toLowerCase() : '(no ext)';
    extCounts[ext] = (extCounts[ext] ? extCounts[ext] : 0) + 1;
  });
  const extListEl = document.getElementById('cb-merge-ext-list');
  extListEl.innerHTML = '';
  Object.keys(extCounts).sort().forEach(ext => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex; align-items:center; gap:4px; background:#383838; padding:4px 8px; border-radius:4px; cursor:pointer;';
    lbl.innerHTML = `<input type="checkbox" class="cb-merge-ext-cb" value="${ext}" checked style="margin:0; cursor:pointer;"> <span>${ext} (${extCounts[ext]})</span>`;
    extListEl.appendChild(lbl);
  });
  document.getElementById('cb-merge-filename').value = getDatestampedMergeFilename();
  const execBtn = document.getElementById('cb-btn-exec-merge');
  execBtn.textContent = attachAfterSave ? "📋 Merge & Attach" : "📦 Save Merge File";
  execBtn.style.background = attachAfterSave ? "#7b1fa2" : "#0288d1";
  mergeModal.style.display = 'flex';
}
// --------------------------------------------------------
document.getElementById('cb-btn-close-merge').addEventListener('click', () => { mergeModal.style.display = 'none'; });
document.getElementById('cb-btn-cancel-merge').addEventListener('click', () => { mergeModal.style.display = 'none'; });
btnMergeSave.addEventListener('click', () => openMergePopup(false));
btnMergePaste.addEventListener('click', () => openMergePopup(true));
// --------------------------------------------------------
document.getElementById('cb-btn-exec-merge').addEventListener('click', async () => {
  const selectedExts = Array.from(document.querySelectorAll('.cb-merge-ext-cb:checked')).map(cb => cb.value);
  let targetFilename = document.getElementById('cb-merge-filename').value.trim();
  if (!targetFilename) targetFilename = getDatestampedMergeFilename();
  if (!targetFilename.includes('.')) targetFilename += '.txt';
  mergeModal.style.display = 'none';
  if (selectedExts.length === 0) {
    statusDiv.textContent = "⚠️ No file types selected to merge.";
    return;
  }
  const checkedInputs = Array.from(fileList.querySelectorAll('.file-item input[type="checkbox"]:checked'));
  const targetPaths = checkedInputs.map(cb => cb.value).filter(p => {
    if (!p ? true : isInternalMetaFile(p)) return false;
    const base = p.split('/').pop();
    const dotIdx = base.lastIndexOf('.');
    const ext = dotIdx !== -1 ? base.substring(dotIdx).toLowerCase() : '(no ext)';
    return selectedExts.includes(ext);
  });
  if (targetPaths.length === 0) {
    statusDiv.textContent = "⚠️ No matching files to merge.";
    return;
  }
  statusDiv.textContent = `⏳ Merging ${targetPaths.length} files...`;
  let mergedBlocks = [];
  for (const path of targetPaths) {
    const handle = fileHandles[path];
    if (!handle) continue;
    try {
      const fileData = await handle.getFile();
      let content = (await fileData.text()).replace(/\r\n/g, '\n').trim();
      const startTag = getCommentWrappedDelimiter("START", path);
      const endTag = getCommentWrappedDelimiter("END", path);
      const hasStartAlready = content.includes(START_MARKER);
      mergedBlocks.push(hasStartAlready ? content : `${startTag}\n${content}\n${endTag}`);
      logAndTrackFile("Merge Read", path);
    } catch (e) {}
  }
  if (mergedBlocks.length === 0) {
    statusDiv.textContent = "❌ Failed to read selected files.";
    return;
  }
  const finalMergedText = mergedBlocks.join('\n// --------------------------------------------------------\n');
  try {
    const mergedHandle = await directoryHandle.getFileHandle(targetFilename, { create: true });
    const writable = await mergedHandle.createWritable();
    await writable.write(finalMergedText);
    await writable.close();
    fileHandles[targetFilename] = mergedHandle;
    fileSizes[targetFilename] = finalMergedText.length;
    logAndTrackFile("Merge Create", targetFilename);
    await loadFilesFromHandle(directoryHandle);
    if (!pendingMergeAttachMode) {
      statusDiv.textContent = `✅ Merged ${mergedBlocks.length} files into ${targetFilename}!`;
      return;
    }
    const inputBox = findChatInputBox();
    if (!inputBox) {
      statusDiv.textContent = `✅ Saved ${targetFilename}, but chat input box was not found.`;
      return;
    }
    const fileObj = await mergedHandle.getFile();
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(fileObj);
    inputBox.focus();
    inputBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true, composed: true }));
    if (!window.location.hostname.includes('gemini')) {
      const fileInput = document.querySelector('input[type="file"]:not(#codebridge-sidebar *)');
      if (fileInput) {
        try {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
          setter.call(fileInput, dataTransfer.files);
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {}
      }
    }
    statusDiv.textContent = `📋 Attached ${targetFilename} (${mergedBlocks.length} files) into chat!`;
    logAndTrackFile("Merge Paste", targetFilename);
  } catch (e) {
    statusDiv.textContent = `❌ Merge Error: ${e.message}`;
  }
});
// --------------------------------------------------------
function syncRoleWithRouter() {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.sendMessage({
      action: "register_role",
      role: currentAgentRole,
      workspace: directoryHandle ? directoryHandle.name : "default",
      status: isSystemActive ? "active" : "stopped"
    });
  } catch (e) {}
}
// --------------------------------------------------------
btnPower.addEventListener('click', () => {
  isSystemActive = !isSystemActive;
  if (isSystemActive) {
    btnPower.textContent = "▶️ System Active";
    btnPower.style.backgroundColor = "#388e3c";
    statusDiv.textContent = "System running. Listening to chat...";
  } else {
    btnPower.textContent = "⏸ System Stopped";
    btnPower.style.backgroundColor = "#d32f2f";
    statusDiv.textContent = "System stopped. Normal browsing active.";
  }
  updateTabTitle();
  syncRoleWithRouter();
});
// --------------------------------------------------------
// WORKSPACE CONFIG & SECURE TOKEN ENGINE
// --------------------------------------------------------
let configSaveTimeout = null;
async function syncGitTokenUI() {
  if (!isExtensionContextValid()) return;
  try {
    if (!chrome.storage ? true : !chrome.storage.local) return;
    const wsGitKey = directoryHandle ? `git_token_ws_${directoryHandle.name}` : null;
    const wsGasKey = directoryHandle ? `gas_client_id_ws_${directoryHandle.name}` : null;
    const keysToFetch = ["global_git_token", "global_gas_client_id"];
    if (wsGitKey) keysToFetch.push(wsGitKey);
    if (wsGasKey) keysToFetch.push(wsGasKey);
    const data = await chrome.storage.local.get(keysToFetch);
    const tokenEl = document.getElementById('cb-git-token');
    if (tokenEl) {
      if (wsGitKey && data[wsGitKey]) tokenEl.value = data[wsGitKey];
      else if (data.global_git_token) tokenEl.value = data.global_git_token;
      else tokenEl.value = "";
    }
    const gasClientEl = document.getElementById('cb-gas-client-id');
    if (gasClientEl) {
      if (wsGasKey && data[wsGasKey]) gasClientEl.value = data[wsGasKey];
      else if (data.global_gas_client_id) gasClientEl.value = data.global_gas_client_id;
      else gasClientEl.value = "";
    }
  } catch (e) {}
}
// --------------------------------------------------------
async function loadWorkspaceConfig() {
  await syncGitTokenUI();
  if (!directoryHandle) {
    const scriptEl = document.getElementById('cb-script-id');
    if (scriptEl) scriptEl.value = "";
    return;
  }
  let config = {};
  try {
    const handle = await directoryHandle.getFileHandle('.anyai_config.json');
    const text = await (await handle.getFile()).text();
    config = JSON.parse(text);
  } catch (e) {
    config = { 'cb-git-branch': 'main', 'cb-git-commit-msg': 'AAA Update', 'cb-file-filter': DEFAULT_CLEAN_EXCLUDE };
  }
  const scriptEl = document.getElementById('cb-script-id');
  if (scriptEl) scriptEl.value = config['cb-script-id'] ? config['cb-script-id'] : "";
  const inputs = ['cb-file-filter', 'cb-git-commit-msg', 'cb-regex'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el && config[id] !== undefined) {
      if (id === 'cb-file-filter' && (config[id] === '.git, .env, .md' || config[id] === '.json, .git, .env, .md')) {
        el.value = DEFAULT_CLEAN_EXCLUDE;
      } else {
        el.value = config[id];
      }
    }
  });
  const checks = ['cb-autopush-toggle', 'cb-backup-toggle', 'cb-patch-toggle', 'cb-map-toggle', 'cb-agent-toggle', 'cb-diff-toggle', 'cb-auto-answer', 'cb-auto-pull'];
  checks.forEach(id => {
    const el = document.getElementById(id);
    if (el && config[id] !== undefined) el.checked = config[id];
  });
  const savedRepo = config['cb-git-repo'];
  const savedBranch = config['cb-git-branch'] ? config['cb-git-branch'] : 'main';
  if (savedRepo && savedRepo !== '__CREATE__') {
    if (!Array.from(repoSelect.options).some(o => o.value === savedRepo)) {
      const opt = document.createElement('option');
      opt.value = savedRepo;
      opt.textContent = savedRepo;
      repoSelect.insertBefore(opt, repoSelect.children[1]);
    }
    repoSelect.value = savedRepo;
    branchSelect.innerHTML = `<option value="${savedBranch}">${savedBranch}</option>`;
    if (document.getElementById('cb-git-token').value) fetchGitHubBranches(savedRepo, savedBranch);
  } else {
    repoSelect.value = "";
    branchSelect.innerHTML = `<option value="main">main</option>`;
  }
  await applyLiveWorkspaceFilter(true);
}
// --------------------------------------------------------
async function saveWorkspaceConfig() {
  try {
    if (isExtensionContextValid() && chrome.storage && chrome.storage.local) {
      const payload = {};
      const gitToken = document.getElementById('cb-git-token').value.trim();
      if (gitToken) {
        payload["global_git_token"] = gitToken;
        if (directoryHandle) payload[`git_token_ws_${directoryHandle.name}`] = gitToken;
      }
      const gasClientEl = document.getElementById('cb-gas-client-id');
      const gasClientId = gasClientEl ? gasClientEl.value.trim() : "";
      if (gasClientId) {
        payload["global_gas_client_id"] = gasClientId;
        if (directoryHandle) payload[`gas_client_id_ws_${directoryHandle.name}`] = gasClientId;
      }
      if (Object.keys(payload).length > 0) {
        chrome.storage.local.set(payload).catch(() => {});
      }
    }
  } catch (e) {}
  if (!directoryHandle) return;
  const config = {};
  const inputs = ['cb-script-id', 'cb-git-repo', 'cb-git-branch', 'cb-file-filter', 'cb-git-commit-msg', 'cb-regex'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) config[id] = el.value;
  });
  const checks = ['cb-autopush-toggle', 'cb-backup-toggle', 'cb-patch-toggle', 'cb-map-toggle', 'cb-agent-toggle', 'cb-diff-toggle', 'cb-auto-answer', 'cb-auto-pull'];
  checks.forEach(id => {
    const el = document.getElementById(id);
    if (el) config[id] = el.checked;
  });
  try {
    const handle = await directoryHandle.getFileHandle('.anyai_config.json', { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(config, null, 2));
    await writable.close();
  } catch (e) {}
}
// --------------------------------------------------------
document.body.addEventListener('input', (e) => {
  if (e.target.id === 'cb-file-filter') {
    applyLiveWorkspaceFilter(false);
  }
  const targets = ['cb-script-id', 'cb-gas-client-id', 'cb-git-token', 'cb-file-filter', 'cb-git-commit-msg', 'cb-regex'];
  if (targets.includes(e.target.id)) {
    clearTimeout(configSaveTimeout);
    configSaveTimeout = setTimeout(() => {
      saveWorkspaceConfig();
      if (e.target.id === 'cb-file-filter') applyLiveWorkspaceFilter(true);
    }, 600);
  }
});
// --------------------------------------------------------
document.body.addEventListener('change', (e) => {
  const targets = ['cb-autopush-toggle', 'cb-backup-toggle', 'cb-patch-toggle', 'cb-map-toggle', 'cb-agent-toggle', 'cb-diff-toggle', 'cb-auto-answer', 'cb-auto-pull'];
  if (targets.includes(e.target.id)) saveWorkspaceConfig();
});
// --------------------------------------------------------
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle_sidebar") {
      isSidebarOpen = !isSidebarOpen;
      sidebar.style.display = isSidebarOpen ? 'flex' : 'none';
      if (isSidebarOpen && !directoryHandle) attemptAutoLoad();
      updatePromptPlaceholder();
      sendResponse({ success: true });
    }
    if (request.action === "receive_agent_message") {
      const activeRole = currentAgentRole ? currentAgentRole : "Agent";
      const formattedMsg = `[INCOMING DM FROM @${request.sourceRole}]\n${request.message}\n\n[SYSTEM: You are acting as ${activeRole}. To reply back to ${request.sourceRole}, begin your message with [@${request.sourceRole}].]`;
      sendToChat(null, true, formattedMsg);
      statusDiv.textContent = `Message from ${request.sourceRole}`;
      consecutiveErrors = 0;
      sendResponse({ success: true });
    }
    if (request.action === "receive_broadcast") {
      sendToChat(null, true, `[BROADCAST from ${request.sourceRole}]\n${request.message}`);
      statusDiv.textContent = `Broadcast from ${request.sourceRole}`;
      sendResponse({ role: currentAgentRole ? currentAgentRole : "Unassigned", status: isSystemActive ? "active" : "stopped" });
    }
    if (request.action === "getLatestAssistantResponse") {
      const currentText = getCurrentAssistantResponseText();
      if (!currentText ? true : currentText.trim() === "") {
        sendResponse({ success: false, error: "No assistant response found" });
      } else {
        sendResponse({ success: true, text: currentText });
      }
    }
    return true;
  });
}
// --------------------------------------------------------
btnClose.addEventListener('click', () => {
  isSidebarOpen = false;
  sidebar.style.display = 'none';
});
// --------------------------------------------------------
window.getLatestAssistantResponse = function() {
  return getCurrentAssistantResponseText();
};
// --------------------------------------------------------
function persistFileCheckboxState() {
  if (!directoryHandle ? true : !isExtensionContextValid()) return;
  try {
    if (!chrome.storage ? true : !chrome.storage.local) return;
    const state = { "__selectAll__": selectAllToggle.checked };
    fileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.value) state[cb.value] = cb.checked;
    });
    chrome.storage.local.set({ [`cb-files-${directoryHandle.name}`]: state }).catch(() => {});
  } catch (e) {}
}
// --------------------------------------------------------
selectAllToggle.addEventListener('change', (e) => {
  fileList.querySelectorAll('.file-item').forEach(row => {
    if (row.style.display === 'none') return;
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = e.target.checked;
  });
  persistFileCheckboxState();
});
fileList.addEventListener('change', persistFileCheckboxState);
// --------------------------------------------------------
snippetSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    const promptEl = document.getElementById('cb-prompt');
    promptEl.value = promptEl.value.trim() ? promptEl.value.trim() + "\n" + e.target.value : e.target.value;
    e.target.value = "";
  }
});
// --------------------------------------------------------
roleSelect.addEventListener('change', async (e) => {
  const selectedRole = e.target.value;
  currentAgentRole = selectedRole;
  updateTabTitle();
  syncRoleWithRouter();
  if (directoryHandle) syncSessionUrlFile(directoryHandle);
  if (selectedRole && directoryHandle) {
    localStorage.setItem('cb-role-url-' + currentUrlPath, selectedRole);
    statusDiv.textContent = `Role: ${selectedRole}`;
    try {
      const text = await (await rolesFileHandle.getFile()).text();
      let persona = "";
      let capture = false;
      for (const line of text.split('\n')) {
        if (line.startsWith('## ')) {
          if (capture) break;
          if (line.substring(3).trim() === selectedRole) capture = true;
        } else if (capture && !line.includes(END_MARKER)) {
          persona += line + "\n";
        }
      }
      if (persona.trim()) sendToChat(null, true, `[INIT:${selectedRole}]\n${persona.trim()}`);
    } catch (e) {}
  } else {
    localStorage.removeItem('cb-role-url-' + currentUrlPath);
    statusDiv.textContent = `Role unassigned.`;
  }
});
// --------------------------------------------------------
// MULTI-SESSION MARKDOWN TRACKER & RECOVERY POPUP ENGINE
// --------------------------------------------------------
function detectProviderLabelFromUrl(urlStr) {
  const lower = (urlStr ? urlStr : "").toLowerCase();
  if (lower.includes('gemini.google')) return { name: 'Gemini', color: '#4fc3f7' };
  if (lower.includes('chatgpt.com') ? true : lower.includes('openai.com')) return { name: 'ChatGPT', color: '#81c784' };
  if (lower.includes('claude.ai')) return { name: 'Claude', color: '#ffb74d' };
  if (lower.includes('deepseek.com')) return { name: 'DeepSeek', color: '#64b5f6' };
  if (lower.includes('qwen.ai')) return { name: 'Qwen', color: '#ba68c8' };
  if (lower.includes('kimi.')) return { name: 'Kimi', color: '#4dd0e1' };
  if (lower.includes('perplexity.ai')) return { name: 'Perplexity', color: '#aed581' };
  if (lower.includes('doubao.com')) return { name: 'Doubao', color: '#ff8a65' };
  if (lower.includes('huggingface.co')) return { name: 'HuggingFace', color: '#ffd54f' };
  return { name: 'AI Web', color: '#90a4ae' };
}
// --------------------------------------------------------
async function parseSessionsFromWorkspace() {
  if (!directoryHandle) return [];
  try {
    const sessionFileHandle = await directoryHandle.getFileHandle('.anyai_session.md', { create: true });
    fileHandles['.anyai_session.md'] = sessionFileHandle;
    const text = await (await sessionFileHandle.getFile()).text();
    const rows = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(PIPE_CHAR) ? true : (trimmed.includes('Chat URL') ? true : trimmed.includes('---'))) continue;
      const parts = trimmed.split(PIPE_CHAR).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const role = parts[0];
        const url = parts[1];
        const lastActive = parts[2] ? parts[2] : "";
        if (url.startsWith('http')) rows.push({ role, url, lastActive });
      }
    }
    rows.sort((a, b) => (b.lastActive ? b.lastActive : "").localeCompare(a.lastActive ? a.lastActive : ""));
    return rows;
  } catch (e) {
    return [];
  }
}
// --------------------------------------------------------
async function removeSessionEntryFromWorkspace(targetUrl) {
  if (!directoryHandle) return;
  try {
    const sessionFileHandle = await directoryHandle.getFileHandle('.anyai_session.md', { create: true });
    const text = await (await sessionFileHandle.getFile()).text();
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => !l.includes(targetUrl));
    const updated = lines.join('\n');
    const writable = await sessionFileHandle.createWritable();
    await writable.write(updated);
    await writable.close();
    fileSizes['.anyai_session.md'] = updated.length;
  } catch (e) {}
}
// --------------------------------------------------------
async function openSessionsModal() {
  if (!directoryHandle) {
    statusDiv.textContent = "❌ Select a workspace/folder first.";
    return;
  }
  await syncSessionUrlFile(directoryHandle);
  const listEl = document.getElementById('cb-sessions-list');
  listEl.innerHTML = '<div style="color:#aaa; text-align:center; padding:15px;">Loading sessions...</div>';
  sessionsModal.style.display = 'flex';
  const sessions = await parseSessionsFromWorkspace();
  listEl.innerHTML = '';
  if (sessions.length === 0) {
    listEl.innerHTML = '<div style="color:#aaa; text-align:center; padding:15px;">No sessions recorded in .anyai_session.md yet.</div>';
    return;
  }
  sessions.forEach(item => {
    const prov = detectProviderLabelFromUrl(item.url);
    const isCurrent = item.url === window.location.href;
    const dateShort = item.lastActive ? item.lastActive.replace('T', ' ').substring(0, 19) : 'Unknown time';
    const card = document.createElement('div');
    card.style.cssText = `display:flex; justify-content:space-between; align-items:center; gap:8px; background:${isCurrent ? '#1b3b36' : '#303030'}; border:1px solid ${isCurrent ? '#00897b' : '#444'}; padding:8px 10px; border-radius:5px;`;
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1; min-width:0; overflow:hidden;';
    infoDiv.innerHTML = [
      `<div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">`,
      `  <span style="background:${prov.color}; color:#000; font-weight:bold; font-size:10px !important; padding:1px 6px; border-radius:3px;">${prov.name}</span>`,
      `  <span style="font-weight:bold; color:#fff; font-size:12px !important;">${item.role}</span>`,
      `  <span style="color:#aaa; font-size:10px !important;">${dateShort}</span>`,
      isCurrent ? `  <span style="color:#4db6ac; font-size:10px !important; font-weight:bold;">(Current Tab)</span>` : ``,
      `</div>`,
      `<div title="${item.url}" style="color:#bbb; font-size:11px !important; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.url}</div>`
    ].join('');
    const actionsDiv = document.createElement('div');
    actionsDiv.style.cssText = 'display:flex; gap:5px; flex-shrink:0;';
    const btnLoadHere = document.createElement('button');
    btnLoadHere.textContent = '⚡ Load Here';
    btnLoadHere.title = 'Force current browser tab to load this session URL';
    btnLoadHere.style.cssText = 'background:#0288d1; color:white; border:none; padding:5px 8px; border-radius:4px; cursor:pointer; font-size:11px !important; font-weight:bold;';
    btnLoadHere.addEventListener('click', () => {
      try {
        const u = new URL(item.url);
        if (u.origin === window.location.origin && directoryHandle) {
          localStorage.setItem('cb-workspace-url-' + u.pathname, directoryHandle.name);
          if (item.role && item.role !== 'Unassigned') localStorage.setItem('cb-role-url-' + u.pathname, item.role);
        }
      } catch (e) {}
      window.location.href = item.url;
    });
    const btnNewTab = document.createElement('button');
    btnNewTab.textContent = '↗ New Tab';
    btnNewTab.title = 'Open this session URL in a new browser tab';
    btnNewTab.style.cssText = 'background:#388e3c; color:white; border:none; padding:5px 8px; border-radius:4px; cursor:pointer; font-size:11px !important; font-weight:bold;';
    btnNewTab.addEventListener('click', () => {
      try {
        const u = new URL(item.url);
        if (u.origin === window.location.origin && directoryHandle) {
          localStorage.setItem('cb-workspace-url-' + u.pathname, directoryHandle.name);
          if (item.role && item.role !== 'Unassigned') localStorage.setItem('cb-role-url-' + u.pathname, item.role);
        }
      } catch (e) {}
      window.open(item.url, '_blank');
    });
    const btnDel = document.createElement('button');
    btnDel.textContent = '🗑️';
    btnDel.title = 'Remove this session from .anyai_session.md';
    btnDel.style.cssText = 'background:#d32f2f; color:white; border:none; padding:5px 7px; border-radius:4px; cursor:pointer; font-size:11px !important;';
    btnDel.addEventListener('click', async () => {
      await removeSessionEntryFromWorkspace(item.url);
      openSessionsModal();
    });
    actionsDiv.appendChild(btnLoadHere);
    actionsDiv.appendChild(btnNewTab);
    actionsDiv.appendChild(btnDel);
    card.appendChild(infoDiv);
    card.appendChild(actionsDiv);
    listEl.appendChild(card);
  });
}
// --------------------------------------------------------
btnSessions.addEventListener('click', openSessionsModal);
document.getElementById('cb-btn-close-sessions').addEventListener('click', () => { sessionsModal.style.display = 'none'; });
document.getElementById('cb-btn-cancel-sessions').addEventListener('click', () => { sessionsModal.style.display = 'none'; });
// --------------------------------------------------------
async function syncSessionUrlFile(handle) {
  try {
    const sessionFileHandle = await handle.getFileHandle('.anyai_session.md', { create: true });
    fileHandles['.anyai_session.md'] = sessionFileHandle;
    const file = await sessionFileHandle.getFile();
    let text = await file.text();
    const currentUrl = window.location.href;
    const currentRole = currentAgentRole ? currentAgentRole : "Unassigned";
    const timestamp = new Date().toISOString();
    if (!text.trim()) {
      text = [
        "# AnyAIAgents Workspace Sessions",
        PIPE_CHAR + " Agent Role " + PIPE_CHAR + " Chat URL " + PIPE_CHAR + " Last Active " + PIPE_CHAR,
        PIPE_CHAR + "---" + PIPE_CHAR + "---" + PIPE_CHAR + "---" + PIPE_CHAR
      ].join("\n");
    }
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let urlFound = false;
    const rowEntry = `${PIPE_CHAR} ${currentRole} ${PIPE_CHAR} ${currentUrl} ${PIPE_CHAR} ${timestamp} ${PIPE_CHAR}`;
    const newLines = lines.map(line => {
      if (line.includes(currentUrl)) {
        urlFound = true;
        return rowEntry;
      }
      return line;
    });
    if (!urlFound) newLines.push(rowEntry);
    const updatedContent = newLines.join('\n');
    if (updatedContent !== text) {
      const writable = await sessionFileHandle.createWritable();
      await writable.write(updatedContent);
      await writable.close();
      fileSizes['.anyai_session.md'] = updatedContent.length;
    }
  } catch (e) {}
}
// --------------------------------------------------------
// FILE LOADING & SESSION-SCOPED AUTO-RECONNECT
// --------------------------------------------------------
function resetUnconnectedWorkspaceUI() {
  directoryHandle = null;
  fileHandles = {};
  fileSizes = {};
  snippetsFileHandle = null;
  rolesFileHandle = null;
  currentAgentRole = "";
  fileList.innerHTML = 'No workspace/folder selected';
  btnFolder.textContent = "1. Select Workspace/Folder";
  btnFolder.style.backgroundColor = "#1976d2";
  roleSelect.innerHTML = '<option value="">-- Set Agent Role --</option>';
  roleSelect.disabled = true;
  roleSelect.style.color = "#aaa";
  roleSelect.style.cursor = "not-allowed";
  btnPull.disabled = true;
  btnMergeSave.disabled = true;
  btnMergePaste.disabled = true;
  if (btnSessions) btnSessions.disabled = true;
  const scriptEl = document.getElementById('cb-script-id');
  if (scriptEl) scriptEl.value = "";
  repoSelect.innerHTML = `<option value="">-- Select Repo --</option><option value="__CREATE__">➕ Create New...</option>`;
  branchSelect.innerHTML = `<option value="main">main</option>`;
  syncGitTokenUI();
  updateTabTitle();
  syncRoleWithRouter();
}
// --------------------------------------------------------
async function loadFilesFromHandle(handle) {
  try {
    directoryHandle = handle;
    fileList.innerHTML = '';
    fileHandles = {};
    fileSizes = {};
    snippetsFileHandle = rolesFileHandle = null;
    await loadWorkspaceConfig();
    let savedFileStates = {};
    try {
      if (chrome.storage && chrome.storage.local) {
        const key = `cb-files-${directoryHandle.name}`;
        const data = await chrome.storage.local.get(key);
        if (data[key]) savedFileStates = data[key];
      }
    } catch (e) {}
    selectAllToggle.checked = savedFileStates["__selectAll__"] !== undefined ? savedFileStates["__selectAll__"] : true;
    const filters = parseExcludePatterns();
    await processDirectory(directoryHandle, '', fileList, filters, savedFileStates);
    const ensureFile = async (name, defaults, refSetter) => {
      if (!refSetter()) {
        try {
          const h = await directoryHandle.getFileHandle(name, { create: true });
          const w = await h.createWritable();
          await w.write(defaults);
          await w.close();
          fileHandles[name] = h;
          refSetter(h);
        } catch (e) {}
      }
    };
    await ensureFile('anyai_snippets.md', DEFAULT_SNIPPETS, (h) => h ? snippetsFileHandle = h : snippetsFileHandle);
    await ensureFile('anyai_roles.md', DEFAULT_ROLES, (h) => h ? rolesFileHandle = h : rolesFileHandle);
    try {
      if (snippetsFileHandle) {
        const text = await (await snippetsFileHandle.getFile()).text();
        if (!text.trim()) {
          const w = await snippetsFileHandle.createWritable();
          await w.write(DEFAULT_SNIPPETS);
          await w.close();
        }
      }
      if (rolesFileHandle) {
        const rText = await (await rolesFileHandle.getFile()).text();
        if (!rText.trim()) {
          const rw = await rolesFileHandle.createWritable();
          await rw.write(DEFAULT_ROLES);
          await rw.close();
        }
      }
    } catch (e) {}
    await parseSnippetsFile();
    await parseRolesFile();
    await syncSessionUrlFile(handle);
    roleSelect.disabled = false;
    roleSelect.title = "";
    roleSelect.style.color = "#fff";
    roleSelect.style.cursor = "pointer";
    btnPull.disabled = false;
    btnMergeSave.disabled = false;
    btnMergePaste.disabled = false;
    if (btnSessions) btnSessions.disabled = false;
    btnFolder.textContent = `1. Workspace/Folder: ${handle.name}`;
    btnFolder.style.backgroundColor = "#1976d2";
    await applyLiveWorkspaceFilter(true);
    persistFileCheckboxState();
    await saveDirectoryHandle(handle);
    updateTabTitle();
    syncRoleWithRouter();
    loadPromptTrackingState();
  } catch (error) {
    statusDiv.textContent = 'Failed to load workspace/folder.';
  }
}
// --------------------------------------------------------
async function parseSnippetsFile() {
  if (!snippetsFileHandle) return;
  try {
    const text = await (await snippetsFileHandle.getFile()).text();
    snippetSelect.innerHTML = '<option value="">-- Load Snippet --</option>';
    let currentSection = "";
    let currentKey = null;
    let currentValLines = [];
    const flushSnippet = () => {
      if (!currentKey) return;
      const fullVal = currentValLines.join('\n').trim();
      if (currentSection === 'snippets' ? true : currentSection === 'orchestration') {
        const opt = document.createElement('option');
        opt.value = fullVal;
        opt.textContent = currentKey;
        snippetSelect.appendChild(opt);
      } else if (currentSection === 'auto-agent') {
        if (currentKey.toLowerCase() === 'no code') autoAgentPrompts.noCode = fullVal;
        if (currentKey.toLowerCase() === 'mismatch') autoAgentPrompts.mismatch = fullVal;
      }
      currentKey = null;
      currentValLines = [];
    };
    const reservedTokens = ["@", "BROADCAST\\]", "REQ:", "WEB_CMD:", "MAP\\]", "INIT:", "SYSTEM", "INCOMING"].join(OR_OP);
    const reservedTagRegex = new RegExp("^\\[(?:" + reservedTokens + ")", "i");
    text.replace(/\r\n/g, '\n').split('\n').forEach(rawLine => {
      const trimmed = rawLine.trim();
      if (trimmed.includes("anyai_snippets.md") && (trimmed.includes(START_MARKER) ? true : trimmed.includes(END_MARKER))) return;
      if (trimmed.startsWith('## ')) {
        flushSnippet();
        currentSection = trimmed.substring(3).trim().toLowerCase();
      } else {
        const isReservedInstructionTag = reservedTagRegex.test(trimmed);
        const match = !isReservedInstructionTag ? trimmed.match(/^\[([^\]]+)\](.*)/) : null;
        if (match) {
          flushSnippet();
          currentKey = match[1].trim();
          const firstLineRemainder = match[2].trim();
          if (firstLineRemainder) currentValLines.push(firstLineRemainder);
        } else if (currentKey) {
          currentValLines.push(rawLine);
        }
      }
    });
    flushSnippet();
  } catch (e) {}
}
// --------------------------------------------------------
async function parseRolesFile() {
  if (!rolesFileHandle) return;
  try {
    const text = await (await rolesFileHandle.getFile()).text();
    roleSelect.innerHTML = '<option value="">-- Set Agent Role --</option>';
    text.split('\n').forEach(line => {
      if (line.trim().startsWith('## ')) {
        const role = line.substring(3).trim();
        const opt = document.createElement('option');
        opt.value = role;
        opt.textContent = `Assume: ${role}`;
        roleSelect.appendChild(opt);
      }
    });
    const savedRoleForUrl = localStorage.getItem('cb-role-url-' + currentUrlPath);
    if (savedRoleForUrl && Array.from(roleSelect.options).some(o => o.value === savedRoleForUrl)) {
      roleSelect.value = savedRoleForUrl;
      currentAgentRole = savedRoleForUrl;
      updateTabTitle();
      syncRoleWithRouter();
      statusDiv.textContent = `Restored Role: ${savedRoleForUrl}`;
    } else {
      currentAgentRole = "";
      roleSelect.value = "";
    }
  } catch (e) {}
}
// --------------------------------------------------------
async function attemptAutoLoad() {
  currentUrlPath = window.location.pathname;
  loadPromptTrackingState();
  const savedHandle = await loadDirectoryHandle();
  if (savedHandle) {
    if (await savedHandle.queryPermission({ mode: 'readwrite' }) === 'granted') {
      await loadFilesFromHandle(savedHandle);
    } else {
      resetUnconnectedWorkspaceUI();
      directoryHandle = savedHandle;
      btnFolder.textContent = `1. Connect Workspace/Folder: [${savedHandle.name}]`;
      btnFolder.style.backgroundColor = "#e65100";
      statusDiv.textContent = `Session linked to "${savedHandle.name}". Click button 1 to grant permission.`;
    }
  } else {
    resetUnconnectedWorkspaceUI();
    statusDiv.textContent = "No workspace/folder linked to this session.";
  }
}
// --------------------------------------------------------
btnFolder.addEventListener('click', async () => {
  try {
    if (btnFolder.textContent.includes("Connect Workspace/Folder:") && directoryHandle) {
      if (await directoryHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
        await loadFilesFromHandle(directoryHandle);
        return;
      }
    }
    const newHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
    await loadFilesFromHandle(newHandle);
  } catch (error) {}
});
// --------------------------------------------------------
async function processDirectory(dirHandle, path = '', parentElement, filters, savedFileStates = {}) {
  let entries = [];
  for await (const entry of dirHandle.values()) entries.push(entry);
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'directory' ? -1 : 1)));
  for (const entry of entries) {
    if (['.anyai_backups', '.codebridge_backups', '.git', '.anyai_config.json', 'anyai_instructions.md'].includes(entry.name)) continue;
    if (entry.kind === 'directory') {
      if (shouldExcludePath(path + entry.name, filters)) continue;
      const details = document.createElement('details');
      details.open = true;
      details.style.marginLeft = '10px';
      const summary = document.createElement('summary');
      summary.style.cursor = 'pointer';
      summary.style.fontWeight = 'bold';
      summary.style.fontSize = '13px';
      const folderKey = "folder:" + path + entry.name;
      const folderCb = document.createElement('input');
      folderCb.type = 'checkbox';
      folderCb.value = folderKey;
      folderCb.checked = savedFileStates[folderKey] !== undefined ? savedFileStates[folderKey] : true;
      folderCb.style.float = 'right';
      folderCb.addEventListener('click', (e) => e.stopPropagation());
      folderCb.addEventListener('change', (e) => {
        details.querySelectorAll('.file-item').forEach(row => {
          if (row.style.display === 'none') return;
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb) cb.checked = e.target.checked;
        });
        persistFileCheckboxState();
      });
      summary.appendChild(folderCb);
      summary.appendChild(document.createTextNode(`📁 ${entry.name}`));
      details.appendChild(summary);
      parentElement.appendChild(details);
      await processDirectory(await dirHandle.getDirectoryHandle(entry.name), `${path}${entry.name}/`, details, filters, savedFileStates);
    } else if (entry.kind === 'file') {
      const fullPath = path + entry.name;
      fileHandles[fullPath] = entry;
      try { fileSizes[fullPath] = (await entry.getFile()).size; } catch (e) {}
      if (entry.name === 'anyai_snippets.md' && path === '') snippetsFileHandle = entry;
      if (entry.name === 'anyai_roles.md' && path === '') rolesFileHandle = entry;
      const div = document.createElement('div');
      div.className = 'file-item';
      div.setAttribute('data-cb-filepath', fullPath);
      const isExcluded = shouldExcludePath(fullPath, filters);
      if (isExcluded) div.style.display = 'none';
      if (isInternalMetaFile(entry.name) && path === '') {
        const isMerged = isMergedFileName(entry.name);
        div.style.color = isMerged ? '#4fc3f7' : '#b39ddb';
        const icon = isMerged ? '📦' : '⚙️';
        div.innerHTML = `<div class="file-name" style="cursor:pointer;" title="Click for file actions (${fullPath})">${icon} ${entry.name}</div> <input type="checkbox" value="${fullPath}">`;
      } else {
        const isChecked = !isExcluded && (savedFileStates[fullPath] !== undefined ? savedFileStates[fullPath] : true);
        const checkedAttr = isChecked ? 'checked' : '';
        div.innerHTML = `<div class="file-name" style="cursor:pointer;" title="Click for file actions (${fullPath})">📄 ${entry.name}</div> <input type="checkbox" value="${fullPath}" ${checkedAttr}>`;
      }
      parentElement.appendChild(div);
    }
  }
}
// --------------------------------------------------------
// GITHUB SYNC ENGINE (WITH .GITIGNORE PARSER & BINARY BLOBS)
// --------------------------------------------------------
async function fetchGitHubBranches(repoName, preferredBranch = null) {
  if (!repoName ? true : (repoName === '__CREATE__' ? true : repoName === '__CREATING__')) return;
  const token = document.getElementById('cb-git-token').value.trim();
  if (!token) return;
  const targetSelection = preferredBranch ? preferredBranch : (branchSelect.value ? branchSelect.value : 'main');
  try {
    const res = await fetch(`https://api.github.com/repos/${repoName}/branches?per_page=100`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    branchSelect.innerHTML = '';
    if (!res.ok) {
      branchSelect.innerHTML = `<option value="${targetSelection}">${targetSelection}</option>`;
      return;
    }
    const branches = await res.json();
    if (branches.length === 0) {
      branchSelect.innerHTML = `<option value="main">main</option>`;
    } else {
      branches.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.textContent = b.name;
        branchSelect.appendChild(opt);
      });
    }
    if (Array.from(branchSelect.options).some(o => o.value === targetSelection)) {
      branchSelect.value = targetSelection;
    } else if (branchSelect.options.length > 0) {
      branchSelect.selectedIndex = 0;
    }
    saveWorkspaceConfig();
  } catch (e) {}
}
// --------------------------------------------------------
repoSelect.addEventListener('change', async (e) => {
  const val = e.target.value;
  if (val === '__CREATE__') {
    const token = document.getElementById('cb-git-token').value.trim();
    if (!token) {
      alert("Please enter a GitHub PAT first.");
      e.target.selectedIndex = 0;
      return;
    }
    const repoName = prompt("Enter new repository name:");
    if (!repoName) {
      e.target.selectedIndex = 0;
      return;
    }
    const isPrivate = confirm("Make repository private? (OK for Private, Cancel for Public)");
    const creatingOpt = document.createElement('option');
    creatingOpt.value = '__CREATING__';
    creatingOpt.textContent = '⏳ Creating...';
    repoSelect.insertBefore(creatingOpt, repoSelect.firstChild);
    repoSelect.value = '__CREATING__';
    repoSelect.disabled = true;
    statusDiv.textContent = `⏳ Creating repository "${repoName}"...`;
    try {
      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName.trim(), private: isPrivate, auto_init: true })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message ? errJson.message : "Failed to create repository.");
      }
      const data = await res.json();
      creatingOpt.remove();
      repoSelect.disabled = false;
      const opt = document.createElement('option');
      opt.value = data.full_name;
      opt.textContent = data.full_name;
      repoSelect.insertBefore(opt, repoSelect.children[1]);
      repoSelect.value = data.full_name;
      const defaultBranch = data.default_branch ? data.default_branch : 'main';
      await fetchGitHubBranches(data.full_name, defaultBranch);
      saveWorkspaceConfig();
      statusDiv.textContent = `✅ Created & selected ${data.full_name}!`;
    } catch (err) {
      creatingOpt.remove();
      repoSelect.disabled = false;
      repoSelect.selectedIndex = 0;
      statusDiv.textContent = `❌ Error creating repo: ${err.message}`;
    }
  } else {
    saveWorkspaceConfig();
    if (val) fetchGitHubBranches(val);
  }
});
// --------------------------------------------------------
document.getElementById('cb-btn-new-branch').addEventListener('click', async () => {
  const repo = repoSelect.value;
  const currentBranch = branchSelect.value;
  const token = document.getElementById('cb-git-token').value.trim();
  if (!repo ? true : (repo === '__CREATE__' ? true : (!token ? true : !currentBranch))) {
    return alert("Select a valid repository and base branch first.");
  }
  const newBranch = prompt("New branch name:");
  if (!newBranch ? true : !newBranch.trim()) return;
  const cleanBranch = newBranch.trim();
  const newBranchBtn = document.getElementById('cb-btn-new-branch');
  const creatingOpt = document.createElement('option');
  creatingOpt.value = '__CREATING__';
  creatingOpt.textContent = '⏳ Creating...';
  branchSelect.insertBefore(creatingOpt, branchSelect.firstChild);
  branchSelect.value = '__CREATING__';
  branchSelect.disabled = true;
  newBranchBtn.disabled = true;
  statusDiv.textContent = `⏳ Creating branch "${cleanBranch}"...`;
  try {
    const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${currentBranch}`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (!refRes.ok) throw new Error(`Base branch "${currentBranch}" not found.`);
    const refData = await refRes.json();
    const createRes = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${cleanBranch}`, sha: refData.object.sha })
    });
    if (!createRes.ok) {
      const errJson = await createRes.json().catch(() => ({}));
      throw new Error(errJson.message ? errJson.message : "Failed to create branch.");
    }
    branchSelect.disabled = false;
    newBranchBtn.disabled = false;
    await fetchGitHubBranches(repo, cleanBranch);
    if (!Array.from(branchSelect.options).some(o => o.value === cleanBranch)) {
      const opt = document.createElement('option');
      opt.value = cleanBranch;
      opt.textContent = cleanBranch;
      branchSelect.appendChild(opt);
    }
    branchSelect.value = cleanBranch;
    saveWorkspaceConfig();
    statusDiv.textContent = `✅ Created & selected branch "${cleanBranch}"!`;
  } catch (e) {
    creatingOpt.remove();
    branchSelect.disabled = false;
    newBranchBtn.disabled = false;
    branchSelect.value = currentBranch;
    statusDiv.textContent = `❌ Branch Error: ${e.message}`;
  }
});
// --------------------------------------------------------
document.getElementById('cb-btn-fetch-repos').addEventListener('click', async () => {
  const token = document.getElementById('cb-git-token').value.trim();
  if (!token) return statusDiv.textContent = "❌ Enter a GitHub PAT first.";
  statusDiv.textContent = "⏳ Fetching repositories...";
  try {
    const repos = await (await fetch(`https://api.github.com/user/repos?sort=updated&per_page=100`, {
      headers: { 'Authorization': `token ${token}` }
    })).json();
    const prevSelected = repoSelect.value;
    repoSelect.innerHTML = `<option value="">-- Select Repo --</option><option value="__CREATE__">➕ Create New...</option>`;
    repos.forEach(r => {
      const o = document.createElement('option');
      o.value = r.full_name;
      o.textContent = r.full_name;
      repoSelect.appendChild(o);
    });
    if (prevSelected && Array.from(repoSelect.options).some(o => o.value === prevSelected)) {
      repoSelect.value = prevSelected;
    }
    statusDiv.textContent = `✅ Loaded ${repos.length} repos.`;
  } catch (e) {
    statusDiv.textContent = "❌ Failed to fetch repos.";
  }
});
// --------------------------------------------------------
function wildcardMatchRule(text, pattern) {
  const parts = pattern.toLowerCase().split('*');
  let pos = 0;
  const lowerText = text.toLowerCase();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const idx = lowerText.indexOf(part, pos);
    if (idx === -1) return false;
    if (i === 0 && !pattern.startsWith('*') && idx !== 0) return false;
    pos = idx + part.length;
  }
  if (!pattern.endsWith('*') && parts[parts.length - 1]) {
    return lowerText.endsWith(parts[parts.length - 1]);
  }
  return true;
}
// --------------------------------------------------------
async function pushToGitHub() {
  const token = document.getElementById('cb-git-token').value.trim();
  const repo = repoSelect.value;
  const branch = document.getElementById('cb-git-branch').value.trim();
  const msgVal = document.getElementById('cb-git-commit-msg').value.trim();
  const msg = msgVal ? msgVal : "AAA Update";
  if (!token ? true : (!repo ? true : (!branch ? true : repo === '__CREATE__'))) {
    return statusDiv.textContent = "❌ Missing GitHub PAT, Repo, or Branch.";
  }
  statusDiv.textContent = "⏳ Pushing to GitHub...";
  try {
    const headers = {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    };
    const baseUrl = `https://api.github.com/repos/${repo}`;
    let refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) {
      statusDiv.textContent = "⏳ Initializing branch...";
      const initRes = await fetch(`${baseUrl}/contents/README.md`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ message: "Initial commit", content: btoa("Initialized by AnyAIAgents"), branch: branch })
      });
      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(`Init API Error: ${errData.message ? errData.message : initRes.statusText}`);
      }
      refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
      if (!refRes.ok) throw new Error("Failed to fetch branch reference.");
    }
    const refData = await refRes.json();
    const commitSha = refData.object.sha;
    const commitData = await (await fetch(`${baseUrl}/git/commits/${commitSha}`, { headers })).json();
    const treeSha = commitData.tree.sha;
    statusDiv.textContent = "⏳ Reading workspace files & .gitignore...";
    const newTree = [];
    let gitignoreRules = [];
    const gitignoreHandle = fileHandles['.gitignore'];
    if (gitignoreHandle) {
      try {
        const gitignoreText = await (await gitignoreHandle.getFile()).text();
        gitignoreRules = gitignoreText
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
      } catch (e) {}
    }
    const hardExcluded = [
      'anyai_activity.csv',
      '.anyai_session.md',
      '.anyai_config.json',
      'anyai_roles.md',
      'anyai_snippets.md',
      'anyai_instructions.md',
      'file_list.txt'
    ];
    function isIgnoredByGitignore(filePath) {
      if (hardExcluded.includes(filePath) || hardExcluded.includes(filePath.split('/').pop())) return true;
      let ignored = false;
      const fileName = filePath.split('/').pop();
      for (let rule of gitignoreRules) {
        const isNegated = rule.startsWith('!');
        if (isNegated) rule = rule.slice(1).trim();
        if (!rule) continue;
        const cleanRule = rule.replace(/^\//, '');
        let matched = false;
        if (cleanRule.endsWith('/')) {
          const dirPrefix = cleanRule.slice(0, -1);
          matched = filePath === dirPrefix || filePath.startsWith(cleanRule) || filePath.includes('/' + cleanRule);
        } else {
          matched = wildcardMatchRule(filePath, cleanRule) || wildcardMatchRule(fileName, cleanRule);
        }
        if (matched) ignored = !isNegated;
      }
      return ignored;
    }
    for (const [path, handle] of Object.entries(fileHandles)) {
      if (!handle ? true : isMergedFileName(path)) continue;
      if (isIgnoredByGitignore(path)) continue;
      const lower = path.toLowerCase();
      try {
        const fileObj = await handle.getFile();
        if (lower.endsWith('.png') ? true : (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))) {
          const buffer = await fileObj.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let b = 0; b < bytes.byteLength; b++) binary += String.fromCharCode(bytes[b]);
          const base64 = btoa(binary);
          const blobRes = await fetch(`${baseUrl}/git/blobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content: base64, encoding: 'base64' })
          });
          if (blobRes.ok) {
            const blobData = await blobRes.json();
            newTree.push({ path: path, mode: '100644', type: 'blob', sha: blobData.sha });
          }
        } else {
          const textContent = await fileObj.text();
          newTree.push({ path: path, mode: '100644', type: 'blob', content: textContent });
        }
      } catch (fileErr) {}
    }
    if (newTree.length === 0) throw new Error("No valid workspace files found to commit.");
    statusDiv.textContent = "⏳ Uploading tree...";
    const treeRes = await fetch(`${baseUrl}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: treeSha, tree: newTree })
    });
    if (!treeRes.ok) {
      const errData = await treeRes.json().catch(() => ({}));
      throw new Error(`Tree API Error: ${errData.message ? errData.message : treeRes.statusText}`);
    }
    const newTreeData = await treeRes.json();
    statusDiv.textContent = "⏳ Creating commit...";
    const newCommitRes = await fetch(`${baseUrl}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: msg, tree: newTreeData.sha, parents: [commitSha] })
    });
    if (!newCommitRes.ok) {
      const errData = await newCommitRes.json().catch(() => ({}));
      throw new Error(`Commit Error: ${errData.message ? errData.message : newCommitRes.statusText}`);
    }
    const newCommitData = await newCommitRes.json();
    statusDiv.textContent = "⏳ Updating branch reference...";
    const patchRes = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newCommitData.sha, force: true })
    });
    if (!patchRes.ok) {
      const errData = await patchRes.json().catch(() => ({}));
      throw new Error(`Branch Update Error: ${errData.message ? errData.message : patchRes.statusText}`);
    }
    statusDiv.textContent = `✅ Pushed ${newTree.length} files to GitHub!`;
    logAndTrackFile("Git Push", `${repo}@${branch}`);
  } catch (e) {
    statusDiv.textContent = `❌ Git Push Error: ${e.message}`;
  }
}
document.getElementById('cb-btn-push-git').addEventListener('click', pushToGitHub);
// --------------------------------------------------------
async function pullFromGitHub() {
  if (!directoryHandle) return statusDiv.textContent = "❌ Select & connect a local workspace/folder first.";
  const token = document.getElementById('cb-git-token').value.trim();
  const repo = repoSelect.value;
  const branch = document.getElementById('cb-git-branch').value.trim();
  if (!token ? true : (!repo ? true : (!branch ? true : repo === '__CREATE__'))) {
    return statusDiv.textContent = "❌ Missing GitHub PAT, Repo, or Branch.";
  }
  statusDiv.textContent = `⏳ Fetching ${repo}@${branch}...`;
  try {
    const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' };
    const baseUrl = `https://api.github.com/repos/${repo}`;
    const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
    if (!refRes.ok) {
      const errData = await refRes.json().catch(() => ({}));
      throw new Error(`Branch Error (${refRes.status}): ${errData.message ? errData.message : refRes.statusText}`);
    }
    const commitSha = (await refRes.json()).object.sha;
    statusDiv.textContent = "⏳ Downloading file tree...";
    const treeRes = await fetch(`${baseUrl}/git/trees/${commitSha}?recursive=1`, { headers });
    if (!treeRes.ok) {
      const errData = await treeRes.json().catch(() => ({}));
      throw new Error(`Tree Error (${treeRes.status}): ${errData.message ? errData.message : treeRes.statusText}`);
    }
    const treeData = await treeRes.json();
    const blobs = (treeData.tree ? treeData.tree : []).filter(item => item.type === 'blob');
    if (blobs.length === 0) return statusDiv.textContent = "⚠️ Repository branch is empty.";
    let pulledCount = 0;
    for (const item of blobs) {
      if (['.anyai_config.json', 'anyai_activity.csv', 'anyai_instructions.md'].includes(item.path)) continue;
      statusDiv.textContent = `⬇️ Pulling (${pulledCount + 1}/${blobs.length}): ${item.path.split('/').pop()}...`;
      const blobRes = await fetch(item.url, { headers });
      if (!blobRes.ok) throw new Error(`Failed to fetch ${item.path}`);
      const blobData = await blobRes.json();
      const base64Clean = (blobData.content ? blobData.content : '').replace(/\s/g, '');
      const binaryStr = atob(base64Clean);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const textContent = new TextDecoder('utf-8').decode(bytes);
      const parts = item.path.split('/');
      const fileName = parts.pop();
      let currentDir = directoryHandle;
      for (const folder of parts) {
        if (folder.trim() === '') continue;
        currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
      }
      const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(textContent);
      await writable.close();
      pulledCount++;
    }
    await loadFilesFromHandle(directoryHandle);
    statusDiv.textContent = `✅ Pulled ${pulledCount} files from ${repo}!`;
    logAndTrackFile("Git Pull", `${repo}@${branch}`);
  } catch (e) {
    statusDiv.textContent = `❌ Git Pull Error: ${e.message}`;
  }
}
document.getElementById('cb-btn-pull-git').addEventListener('click', pullFromGitHub);
// --------------------------------------------------------
// GOOGLE APPS SCRIPT SYNC ENGINE & IN-PAGE GUIDE MODAL
// --------------------------------------------------------
function showGasManualModal() {
  const existing = document.getElementById('cb-gas-manual-modal');
  if (existing) existing.remove();
  const extId = isExtensionContextValid() ? chrome.runtime.id : 'jokpiedkiljecdpfgckncpjongbdejkn';
  const redirectUri = `https://${extId}.chromiumapp.org/`;
  const overlay = document.createElement('div');
  overlay.id = 'cb-gas-manual-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  overlay.innerHTML = `
    <div style="background:#181818;color:#e0e0e0;width:680px;max-width:92vw;max-height:88vh;overflow-y:auto;border-radius:10px;border:1px solid #444;padding:22px 26px;box-shadow:0 10px 40px rgba(0,0,0,0.8);line-height:1.5;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding-bottom:10px;margin-bottom:14px;">
        <h2 style="color:#4fc3f7;font-size:18px;margin:0;">☁ Google Apps Script OAuth Client ID Guide</h2>
        <button id="cb-close-gas-manual" style="background:#d32f2f;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">✕ Close</button>
      </div>
      <p style="font-size:13px;color:#ccc;margin:0 0 12px 0;">To pull and push Google Apps Script projects directly from your browser, AnyAIAgents uses your own Google Cloud OAuth Client ID (stored strictly locally on your device).</p>
      <h3 style="color:#81c784;font-size:14px;margin:14px 0 6px 0;">Step 1: Copy Your Extension Redirect URI</h3>
      <div style="background:#252525;border:1px solid #0288d1;padding:8px 12px;border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <code style="color:#ffb74d;font-family:monospace;font-size:12px;word-break:break-all;">${redirectUri}</code>
        <button id="cb-copy-gas-uri" style="background:#0288d1;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;white-space:nowrap;">📋 Copy URI</button>
      </div>
      <h3 style="color:#81c784;font-size:14px;margin:16px 0 6px 0;">Step 2: Enable the Google Apps Script API</h3>
      <ol style="font-size:13px;color:#ccc;padding-left:20px;margin:0;">
        <li style="margin-bottom:6px;">Open <a href="https://console.cloud.google.com/apis/library/script.googleapis.com" target="_blank" style="color:#4fc3f7;">Google Cloud Console - Apps Script API Library</a> and click <b>Enable</b>.</li>
        <li style="margin-bottom:6px;">Open <a href="https://script.google.com/home/usersettings" target="_blank" style="color:#4fc3f7;">script.google.com/home/usersettings</a> and switch <b>Google Apps Script API</b> to <b>ON</b>.</li>
      </ol>
      <h3 style="color:#81c784;font-size:14px;margin:16px 0 6px 0;">Step 3: Configure OAuth Consent Screen</h3>
      <ol style="font-size:13px;color:#ccc;padding-left:20px;margin:0;">
        <li style="margin-bottom:6px;">Go to <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" style="color:#4fc3f7;">APIs &amp; Services &rarr; OAuth consent screen</a>.</li>
        <li style="margin-bottom:6px;">Choose <b>External</b> (or Internal), enter an app name (e.g. <code>AnyAIAgents Local</code>) and your email, and Save.</li>
        <li style="margin-bottom:6px;">Under <b>Audience / Test users</b>, click <b>+ Add Users</b> and add your own Gmail address.</li>
      </ol>
      <h3 style="color:#81c784;font-size:14px;margin:16px 0 6px 0;">Step 4: Create Your OAuth Client ID</h3>
      <ol style="font-size:13px;color:#ccc;padding-left:20px;margin:0;">
        <li style="margin-bottom:6px;">Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:#4fc3f7;">APIs &amp; Services &rarr; Credentials</a> and click <b>+ Create Credentials &rarr; OAuth client ID</b>.</li>
        <li style="margin-bottom:6px;">Select Application type: <b>Web application</b>.</li>
        <li style="margin-bottom:6px;">Under <b>Authorized redirect URIs</b>, click <b>+ Add URI</b> and paste the Redirect URI from Step 1.</li>
        <li style="margin-bottom:6px;">Click <b>Create</b>, copy the <b>Client ID</b> (ending in <code>.apps.googleusercontent.com</code>), and paste it into the <b>Google OAuth Client ID</b> box in the sidebar!</li>
      </ol>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.id === 'cb-close-gas-manual') {
      overlay.remove();
    }
  });
  const copyBtn = document.getElementById('cb-copy-gas-uri');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(redirectUri);
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy URI'; }, 2000);
    });
  }
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'cb-btn-gas-manual') {
    e.preventDefault();
    e.stopPropagation();
    showGasManualModal();
  }
});
// --------------------------------------------------------
function getGasToken() {
  return new Promise((resolve, reject) => {
    const clientEl = document.getElementById('cb-gas-client-id');
    const clientId = clientEl ? clientEl.value.trim() : "";
    if (!clientId) {
      reject(new Error("Missing Google OAuth Client ID. Click '❓ Guide' in the Google Apps Script section."));
      return;
    }
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage({ action: "get_gas_token", clientId: clientId }, (res) => {
        if (res && res.success) resolve(res.token);
        else reject(new Error(res && res.error ? res.error : "Authentication failed. Check your Google OAuth Client ID."));
      });
    } else {
      reject(new Error("Extension context invalidated. Refresh page."));
    }
  });
}
// --------------------------------------------------------
async function pullFromGAS() {
  if (!directoryHandle) return statusDiv.textContent = "❌ Select a workspace/folder first.";
  const scriptId = document.getElementById('cb-script-id').value.trim();
  if (!scriptId) return statusDiv.textContent = "Missing GAS Script ID.";
  statusDiv.textContent = "Authenticating with Google...";
  try {
    const token = await getGasToken();
    statusDiv.textContent = "Pulling from GAS...";
    const res = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (!data.files) throw new Error("No files found in GAS project.");
    for (const file of data.files) {
      let ext = '.js';
      if (file.type === 'HTML') ext = '.html';
      else if (file.type === 'JSON' ? true : file.name === 'appsscript') ext = '.json';
      const fileName = `${file.name}${ext}`;
      const handle = await directoryHandle.getFileHandle(fileName, { create: true });
      fileHandles[fileName] = handle;
      const srcText = file.source ? file.source : '';
      const writable = await handle.createWritable();
      await writable.write(srcText);
      await writable.close();
      fileSizes[fileName] = srcText.length;
      logAndTrackFile("GAS Pull", fileName);
    }
    await loadFilesFromHandle(directoryHandle);
    statusDiv.textContent = `✅ Pulled ${data.files.length} GAS files!`;
  } catch (e) {
    statusDiv.textContent = `❌ GAS Pull Error: ${e.message}`;
  }
}
// --------------------------------------------------------
async function pushToGAS(appendStatus = false) {
  const setGasStatus = (msg) => {
    if (appendStatus) {
      const existingBase = statusDiv.getAttribute('data-pull-summary') ? statusDiv.getAttribute('data-pull-summary') : statusDiv.innerHTML;
      statusDiv.setAttribute('data-pull-summary', existingBase);
      statusDiv.innerHTML = existingBase + `<br><span style="color:#4fc3f7;">☁️ ${msg}</span>`;
    } else {
      statusDiv.textContent = msg;
    }
  };
  const scriptId = document.getElementById('cb-script-id').value.trim();
  if (!scriptId) return setGasStatus("Missing GAS Script ID.");
  setGasStatus("Authenticating with Google...");
  try {
    const token = await getGasToken();
    setGasStatus("Pushing to GAS...");
    const gasFiles = [];
    const jsGsExtRegex = new RegExp("\\.(js" + OR_OP + "gs)$", "i");
    for (const [path, handle] of Object.entries(fileHandles)) {
      if (path.includes('/') ? true : isMergedFileName(path)) continue;
      let type = null;
      let name = '';
      if (path.endsWith('.js') ? true : path.endsWith('.gs')) {
        type = 'SERVER_JS';
        name = path.replace(jsGsExtRegex, '');
      } else if (path.endsWith('.html')) {
        type = 'HTML';
        name = path.replace(/\.html$/i, '');
      } else if (path.endsWith('.json') && path === 'appsscript.json') {
        type = 'JSON';
        name = 'appsscript';
      }
      if (!type) continue;
      let text = await (await handle.getFile()).text();
      text = text.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
      gasFiles.push({ name, type, source: text });
    }
    let manifestFile = gasFiles.find(f => f.name === 'appsscript' && f.type === 'JSON');
    if (manifestFile) {
      try {
        let manifestData = JSON.parse(manifestFile.source);
        manifestData.runtimeVersion = "V8";
        manifestFile.source = JSON.stringify(manifestData, null, 2);
      } catch (e) {}
    } else {
      gasFiles.push({
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify({ timeZone: "Etc/UTC", exceptionLogging: "CLOUD", runtimeVersion: "V8" }, null, 2)
      });
    }
    const res = await fetch(`https://script.googleapis.com/v1/projects/${scriptId}/content`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: gasFiles })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error && errData.error.message ? errData.error.message : res.statusText;
      throw new Error(`HTTP ${res.status}: ${errMsg}`);
    }
    setGasStatus("Pushed to GAS successfully!");
    logAndTrackFile("GAS Push", scriptId);
  } catch (e) {
    setGasStatus(`GAS Push Error: ${e.message}`);
  }
}
document.getElementById('cb-btn-pull-gas').addEventListener('click', () => pullFromGAS());
document.getElementById('cb-btn-push-gas').addEventListener('click', () => pushToGAS(false));
// --------------------------------------------------------
// AGENT ROUTING & BROADCAST ENGINE
// --------------------------------------------------------
async function triggerSystemBroadcast(payload) {
  statusDiv.textContent = "Broadcasting to workspace...";
  if (chrome.runtime && chrome.runtime.id) {
    chrome.runtime.sendMessage({
      action: "broadcast_message",
      workspace: directoryHandle ? directoryHandle.name : "default",
      sourceRole: currentAgentRole ? currentAgentRole : "Orchestrator",
      message: payload
    }, async () => {
      statusDiv.textContent = "Broadcast delivered.";
      updateRoleDropdownColors();
    });
  }
}
// --------------------------------------------------------
function updateRoleDropdownColors() {
  if (!directoryHandle) return;
  try {
    if (!chrome.runtime ? true : !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ action: "get_workspace_statuses", workspace: directoryHandle.name }, (res) => {
      if (res && res.success && res.statuses) {
        const options = roleSelect.options;
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (!opt.value) continue;
          const status = res.statuses[opt.value];
          opt.style.color = status === "active" ? "#4caf50" : (status === "stopped" ? "#ff9800" : "#ffffff");
          opt.style.backgroundColor = "#2a2a2a";
        }
      }
    });
  } catch (e) {}
}
// --------------------------------------------------------
setInterval(() => {
  if (isSidebarOpen && directoryHandle) updateRoleDropdownColors();
}, 3000);
// --------------------------------------------------------
function findChatInputBox() {
  const notSidebar = ':not(#codebridge-sidebar *):not(#cb-diff-modal *):not(#cb-merge-modal *):not(#cb-sessions-modal *)';
  switch (getAIProvider()) {
    case 'gemini':
      return pickFirstTruthy([
        document.querySelector('rich-textarea div[contenteditable="true"]'),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`)
      ]);
    case 'chatgpt':
      return pickFirstTruthy([
        document.querySelector('#prompt-textarea'),
        document.querySelector(`.ProseMirror${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`)
      ]);
    case 'claude':
      return pickFirstTruthy([
        document.querySelector(`div.ProseMirror[contenteditable="true"]${notSidebar}`),
        document.querySelector(`fieldset div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`)
      ]);
    case 'deepseek':
      return pickFirstTruthy([
        document.querySelector(`textarea#chat-input${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`)
      ]);
    case 'perplexity':
      return pickFirstTruthy([
        document.querySelector(`textarea[placeholder*="Ask" i]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`)
      ]);
    case 'qwen': {
      const notMonaco = `${notSidebar}:not(.inputarea):not(.monaco-mouse-cursor-text):not(.monaco-editor *)`;
      return pickFirstTruthy([
        document.querySelector(`textarea#chat-input${notMonaco}`),
        document.querySelector(`textarea[placeholder]${notMonaco}`),
        document.querySelector(`div[contenteditable="true"]${notMonaco}`),
        document.querySelector(`textarea${notMonaco}`)
      ]);
    }
    case 'kimi':
      return pickFirstTruthy([
        document.querySelector(`div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`)
      ]);
    case 'doubao':
      return pickFirstTruthy([
        document.querySelector(`textarea[data-testid*="chat_input" i]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`)
      ]);
    case 'huggingface':
      return pickFirstTruthy([
        document.querySelector(`textarea[placeholder*="Ask" i]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`)
      ]);
    default:
      return pickFirstTruthy([
        document.querySelector('rich-textarea div[contenteditable="true"]'),
        document.querySelector(`div[contenteditable="true"]${notSidebar}`),
        document.querySelector(`textarea${notSidebar}`)
      ]);
  }
}
// --------------------------------------------------------
function attachNativeOrPasteFiles(inputBox, dataTransfer) {
  const fileInput = document.querySelector('input[type="file"]:not(#codebridge-sidebar *)');
  if (fileInput) {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
      setter.call(fileInput, dataTransfer.files);
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    } catch (e) {
      try {
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      } catch (err) {}
    }
  }
  inputBox.focus();
  inputBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true, composed: true }));
}
// --------------------------------------------------------
function setTextareaOrContentEditableText(inputBox, fullMessage) {
  if (inputBox.tagName.toLowerCase() === 'textarea') {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(inputBox, fullMessage);
    } catch (e) {
      inputBox.value = fullMessage;
    }
    inputBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } else {
    inputBox.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, fullMessage);
    const dt = new DataTransfer();
    dt.setData('text/plain', fullMessage);
    inputBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, composed: true }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
}
// --------------------------------------------------------
function findSendButtonByProvider(provider) {
  switch (provider) {
    case 'gemini':
      return document.querySelector('.send-button, button[aria-label*="Send message" i], [mattooltip*="Send message" i], button[aria-label*="Send" i]');
    case 'chatgpt':
      return document.querySelector('button[data-testid="send-button"], button[data-testid*="send"], button[aria-label*="Send" i]');
    case 'claude':
      return document.querySelector('button[aria-label*="Send Message" i], button[aria-label*="Send" i]');
    case 'deepseek': {
      const svgs = document.querySelectorAll('svg');
      for (let s of svgs) {
        if (s.innerHTML.includes('M8.3125 0.980206')) {
          const btn = pickFirstTruthy([s.closest('div[class*="ds-button"]'), s.closest('div[role="button"]'), s.parentElement]);
          if (btn) return btn;
        }
      }
      return document.querySelector('div[role="button"][aria-disabled="false"], button[aria-label*="Send" i], [class*="send-btn" i]');
    }
    case 'perplexity':
      return document.querySelector('button[aria-label*="Submit" i], button[aria-label*="Send" i]');
    case 'qwen': {
      const useEl = document.querySelector('use[xlink\\:href="#qwpcicon-sendChat"], use[href="#qwpcicon-sendChat"], use[xlink\\:href*="sendChat" i], use[href*="sendChat" i]');
      if (useEl) {
        const btnFromUse = pickFirstTruthy([
          useEl.closest('button'),
          useEl.closest('[role="button"]'),
          useEl.closest('[class*="send-button" i]'),
          useEl.closest('span.icon-send'),
          useEl.parentElement ? useEl.parentElement.parentElement : null
        ]);
        if (btnFromUse) return btnFromUse;
      }
      const sendIcon = document.querySelector('span.icon-send, .anticon.icon-send');
      if (sendIcon) {
        const btnFromIcon = pickFirstTruthy([sendIcon.closest('button'), sendIcon.closest('[role="button"]'), sendIcon]);
        if (btnFromIcon) return btnFromIcon;
      }
      return document.querySelector('button.send-button, button[aria-label="Send"], button#send-message-button, [class*="send-button" i], [class*="send-btn" i], button[aria-label*="发送"]');
    }
    case 'kimi':
      return document.querySelector('div[class*="send-button" i], button[aria-label*="Send" i], button[aria-label*="发送"], div[aria-label*="发送"]');
    case 'doubao':
      return document.querySelector('button[data-testid*="send" i], button[aria-label*="Send" i], button[aria-label*="发送"]');
    case 'huggingface':
      return document.querySelector('button[type="submit"][aria-label*="Send" i], form button[type="submit"]');
    default:
      return document.querySelector('.send-button, button[aria-label*="Send message" i], [mattooltip*="Send message" i], button[aria-label*="Send" i]');
  }
}
// --------------------------------------------------------
async function sendToChat(filesToSend, isAutoReply = false, directMessage = null) {
  const inputBox = findChatInputBox();
  if (!inputBox) return;
  const provider = getAIProvider();
  let fullMessage = directMessage ? directMessage : (isAutoReply ? "Requested file attached." : document.getElementById('cb-prompt').value);
  if (!isAutoReply && !directMessage) {
    if (fullMessage.includes(START_MARKER) && fullMessage.includes("FILE OUTPUT FORMAT")) {
      instructionsEverSent = true;
      promptsSinceInstructions = 0;
    } else {
      promptsSinceInstructions++;
    }
    savePromptTrackingState();
  }
  if (!isAutoReply && !directMessage) {
    const routeMatch = fullMessage.match(/^\[@([^\]]+)\]\s*([\s\S]*)/);
    if (routeMatch) {
      const targetRole = routeMatch[1].trim();
      const payload = routeMatch[2].trim();
      statusDiv.textContent = `Routing to ${targetRole}...`;
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          action: "route_message",
          workspace: directoryHandle ? directoryHandle.name : "default",
          sourceRole: currentAgentRole ? currentAgentRole : "User",
          targetRole: targetRole,
          message: payload
        }, (res) => {
          statusDiv.textContent = res && res.success ? `Sent to ${targetRole}` : `Failed: ${targetRole} offline`;
        });
      }
      document.getElementById('cb-prompt').value = "";
      return;
    }
  }
  const isBroadcastChecked = document.getElementById('cb-broadcast-toggle').checked;
  if (!isAutoReply && !directMessage && isBroadcastChecked) {
    document.getElementById('cb-broadcast-toggle').checked = false;
    triggerSystemBroadcast(fullMessage);
  }
  if (filesToSend && filesToSend.length > 0) {
    const dataTransfer = new DataTransfer();
    let hasFiles = false;
    if (provider !== 'chatgpt') {
      for (const path of filesToSend) {
        if (fileHandles[path]) {
          dataTransfer.items.add(await fileHandles[path].getFile());
          logAndTrackFile("Read Content", path);
          hasFiles = true;
        }
      }
    }
    switch (provider) {
      case 'gemini':
        statusDiv.textContent = "Attaching files (Gemini)...";
        if (hasFiles) {
          inputBox.focus();
          inputBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true, composed: true }));
        }
        break;
      case 'chatgpt':
        statusDiv.textContent = "Attaching inline (ChatGPT)...";
        fullMessage += `\n[ATTACHED FILES]\n`;
        for (const path of filesToSend) {
          if (fileHandles[path]) {
            try {
              const rawText = (await (await fileHandles[path].getFile()).text()).replace(/\r\n/g, '\n').trim();
              const hasMarkersAlready = rawText.includes(START_MARKER) && rawText.includes(END_MARKER);
              const startTag = getCommentWrappedDelimiter("START", path);
              const endTag = getCommentWrappedDelimiter("END", path);
              const blockToAppend = hasMarkersAlready ? rawText : `${startTag}\n${rawText}\n${endTag}`;
              fullMessage += `\n${blockToAppend}\n`;
              logAndTrackFile("Read Content", path);
            } catch (err) {}
          }
        }
        break;
      case 'claude':
        statusDiv.textContent = "Attaching files (Claude)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'deepseek':
        statusDiv.textContent = "Attaching files (DeepSeek)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'perplexity':
        statusDiv.textContent = "Attaching files (Perplexity)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'qwen':
        statusDiv.textContent = "Attaching files (Qwen)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'kimi':
        statusDiv.textContent = "Attaching files (Kimi)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'doubao':
        statusDiv.textContent = "Attaching files (Doubao)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      case 'huggingface':
        statusDiv.textContent = "Attaching files (HuggingFace)...";
        if (hasFiles) attachNativeOrPasteFiles(inputBox, dataTransfer);
        break;
      default:
        statusDiv.textContent = "Attaching files (Default/Gemini)...";
        if (hasFiles) {
          inputBox.focus();
          inputBox.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true, composed: true }));
        }
        break;
    }
  }
  const hasAttachments = filesToSend && filesToSend.length > 0;
  setTimeout(async () => {
    if (!isAutoReply && !directMessage && document.getElementById('cb-map-toggle').checked) {
      const patterns = parseExcludePatterns();
      let projectMap = `\n[MAP]\n`;
      for (const path of Object.keys(fileHandles)) {
        if (!isInternalMetaFile(path) && !shouldExcludePath(path, patterns)) {
          projectMap += `- ${path} (${((fileSizes[path] || 0) / 1024).toFixed(1)}KB)\n`;
        }
      }
      fullMessage += projectMap;
    }
    if (currentAgentRole && !directMessage) {
      fullMessage += `\n[SYSTEM: You are acting as ${currentAgentRole}. Stay in character and use [@TargetAgent] or [WEB_CMD: url ${PIPE_CHAR} command ${PIPE_CHAR} selector] format to reply.]`;
    }
    switch (provider) {
      case 'gemini': {
        inputBox.focus();
        const escapedHtml = fullMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        inputBox.innerHTML = `<p>${escapedHtml}</p>`;
        inputBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Space', bubbles: true, composed: true }));
        break;
      }
      case 'chatgpt':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      case 'claude':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      case 'deepseek':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      case 'perplexity':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      case 'qwen': {
        inputBox.focus();
        if (inputBox.tagName.toLowerCase() === 'textarea') {
          const tracker = inputBox._valueTracker;
          if (tracker) tracker.setValue(inputBox.value);
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(inputBox, fullMessage);
          } catch (e) {
            inputBox.value = fullMessage;
          }
          inputBox.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: fullMessage, inputType: 'insertText' }));
          inputBox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } else {
          setTextareaOrContentEditableText(inputBox, fullMessage);
        }
        break;
      }
      case 'kimi':
        inputBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, fullMessage);
        inputBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        break;
      case 'doubao':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      case 'huggingface':
        setTextareaOrContentEditableText(inputBox, fullMessage);
        break;
      default: {
        inputBox.focus();
        const escapedHtml = fullMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        inputBox.innerHTML = `<p>${escapedHtml}</p>`;
        inputBox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inputBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Space', bubbles: true, composed: true }));
        break;
      }
    }
    let attempts = 0;
    let stableReadyCount = 0;
    const requiredTicks = hasAttachments ? 2 : 1;
    const trySend = setInterval(() => {
      attempts++;
      const sendBtn = findSendButtonByProvider(provider);
      switch (provider) {
        case 'gemini': {
          stableReadyCount++;
          if (stableReadyCount >= requiredTicks) {
            clearInterval(trySend);
            if (sendBtn) {
              sendBtn.removeAttribute('disabled');
              sendBtn.setAttribute('aria-disabled', 'false');
              sendBtn.click();
            }
            setTimeout(() => {
              inputBox.focus();
              inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
            }, 100);
            statusDiv.textContent = "Sent (Gemini)!";
            const pEl = document.getElementById('cb-prompt');
            if (pEl && (!isAutoReply ? true : pEl.value === directMessage)) pEl.value = "";
          }
          break;
        }
        case 'qwen': {
          const isDisabled = sendBtn ? [
            Boolean(sendBtn.disabled),
            sendBtn.hasAttribute('disabled'),
            sendBtn.getAttribute('aria-disabled') === 'true',
            sendBtn.classList.contains('disabled')
          ].some(Boolean) : false;
          if (!isDisabled) {
            stableReadyCount++;
            if (stableReadyCount >= requiredTicks) {
              clearInterval(trySend);
              if (sendBtn) {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(evtType => {
                  sendBtn.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
                });
                sendBtn.click();
                const innerIcon = sendBtn.querySelector('span.icon-send, svg, use');
                if (innerIcon && typeof innerIcon.click === 'function') innerIcon.click();
              }
              setTimeout(() => {
                if (inputBox.value && inputBox.value.trim().length > 0) {
                  inputBox.focus();
                  inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
                }
              }, 150);
              statusDiv.textContent = "Sent (qwen)!";
              const pEl = document.getElementById('cb-prompt');
              if (pEl && (!isAutoReply ? true : pEl.value === directMessage)) pEl.value = "";
            }
          } else {
            stableReadyCount = 0;
          }
          break;
        }
        case 'chatgpt':
        case 'claude':
        case 'deepseek':
        case 'perplexity':
        case 'kimi':
        case 'doubao':
        case 'huggingface': {
          if (sendBtn) {
            const isDisabled = [
              Boolean(sendBtn.disabled),
              sendBtn.hasAttribute('disabled'),
              sendBtn.getAttribute('aria-disabled') === 'true',
              sendBtn.classList.contains('disabled')
            ].some(Boolean);
            if (!isDisabled) {
              stableReadyCount++;
              if (stableReadyCount >= requiredTicks) {
                clearInterval(trySend);
                sendBtn.click();
                statusDiv.textContent = `Sent (${provider})!`;
                const pEl = document.getElementById('cb-prompt');
                if (pEl && (!isAutoReply ? true : pEl.value === directMessage)) pEl.value = "";
              }
            } else {
              stableReadyCount = 0;
            }
          } else {
            stableReadyCount++;
            if (stableReadyCount >= requiredTicks) {
              clearInterval(trySend);
              inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              statusDiv.textContent = `Sent (${provider} Keypress)!`;
              const pEl = document.getElementById('cb-prompt');
              if (pEl && (!isAutoReply ? true : pEl.value === directMessage)) pEl.value = "";
            }
          }
          break;
        }
        default: {
          stableReadyCount++;
          if (stableReadyCount >= requiredTicks) {
            clearInterval(trySend);
            if (sendBtn) {
              sendBtn.removeAttribute('disabled');
              sendBtn.setAttribute('aria-disabled', 'false');
              sendBtn.click();
            }
            setTimeout(() => {
              inputBox.focus();
              inputBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
            }, 100);
            statusDiv.textContent = "Sent!";
            const pEl = document.getElementById('cb-prompt');
            if (pEl && (!isAutoReply ? true : pEl.value === directMessage)) pEl.value = "";
          }
          break;
        }
      }
      if (attempts > 30) {
        clearInterval(trySend);
        statusDiv.textContent = "Upload timeout. Click send manually.";
      }
    }, 500);
  }, hasAttachments ? 1500 : 100);
}
// --------------------------------------------------------
btnSend.addEventListener('click', () => {
  const selected = Array.from(fileList.querySelectorAll('.file-item'))
    .filter(row => row.style.display !== 'none')
    .map(row => row.querySelector('input[type="checkbox"]:checked'))
    .filter(Boolean)
    .map(c => c.value);
  sendToChat(selected);
});
// --------------------------------------------------------
// ASSISTANT MESSAGE & CODE BLOCK EXTRACTION ENGINE
// --------------------------------------------------------
function pickLastNonEmptyNode(nodeList) {
  if (!nodeList ? true : nodeList.length === 0) return null;
  for (let i = nodeList.length - 1; i >= 0; i--) {
    const el = nodeList[i];
    const txt = el.innerText ? el.innerText : (el.textContent ? el.textContent : "");
    if (txt && txt.trim().length > 0) return el;
  }
  return nodeList[nodeList.length - 1];
}
// --------------------------------------------------------
function findLatestAssistantMessage() {
  switch (getAIProvider()) {
    case 'gemini': {
      const topTurnContainers = document.querySelectorAll('model-response');
      if (topTurnContainers.length > 0) return topTurnContainers[topTurnContainers.length - 1];
      const geminiContainers = document.querySelectorAll('message-content, .model-response-text');
      if (geminiContainers.length > 0) {
        const lastContainer = geminiContainers[geminiContainers.length - 1];
        const parentTurn = lastContainer.closest('model-response, [class*="conversation-turn"]');
        return parentTurn ? parentTurn : lastContainer;
      }
      const geminiNodes = document.querySelectorAll('p[data-path-to-node]');
      if (geminiNodes.length > 0) {
        const lastNode = geminiNodes[geminiNodes.length - 1];
        const closestContainer = lastNode.closest('model-response, message-content, div[class*="response"], div[class*="message"]');
        return closestContainer ? closestContainer : lastNode.parentElement;
      }
      break;
    }
    case 'chatgpt': {
      const viewerNodes = document.querySelectorAll('[class*="ViewerContent-"]:not(#codebridge-sidebar *)');
      const lastViewer = pickLastNonEmptyNode(viewerNodes);
      if (lastViewer) {
        const parentTurn = lastViewer.closest('article, [data-testid^="conversation-turn-"], [data-message-author-role="assistant"]');
        if (parentTurn) return parentTurn;
      }
      const roleNodes = document.querySelectorAll('[data-message-author-role="assistant"]:not(#codebridge-sidebar *)');
      const validRoleNode = pickLastNonEmptyNode(roleNodes);
      if (validRoleNode) {
        const turnArticle = validRoleNode.closest('article, [data-testid^="conversation-turn-"]');
        return turnArticle ? turnArticle : validRoleNode;
      }
      const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
      if (articles.length > 0) {
        for (let i = articles.length - 1; i >= 0; i--) {
          const art = articles[i];
          if (art.querySelector('[data-message-author-role="user"]')) continue;
          const txt = art.innerText ? art.innerText : (art.textContent ? art.textContent : "");
          if (txt && txt.trim().length > 0) return art;
        }
      }
      if (lastViewer) return lastViewer.parentElement ? lastViewer.parentElement : lastViewer;
      const markdownNodes = document.querySelectorAll('.agent-turn .markdown, .markdown.prose, [class*="markdown"]:not(#codebridge-sidebar *)');
      return pickLastNonEmptyNode(markdownNodes);
    }
    case 'claude': {
      const codeBlocks = document.querySelectorAll('.code-block__code, [class*="code-block__code"]');
      const lastCode = pickLastNonEmptyNode(codeBlocks);
      if (lastCode) {
        const parentTurn = lastCode.closest('[data-test-render-count], .font-claude-message, div[class*="font-claude-response"], div[class*="font-claude"]');
        if (parentTurn) return parentTurn;
      }
      const claudeTurns = document.querySelectorAll('.font-claude-message, div[class*="font-claude-response"], div[class*="font-claude"], [data-test-render-count]');
      const validClaude = pickLastNonEmptyNode(claudeTurns);
      if (validClaude) return validClaude;
      if (lastCode) return lastCode.parentElement ? lastCode.parentElement : lastCode;
      break;
    }
    case 'deepseek': {
      const dsNodes = document.querySelectorAll('.ds-markdown, [class*="ds-markdown"]');
      return pickLastNonEmptyNode(dsNodes);
    }
    case 'perplexity': {
      const pplxNodes = document.querySelectorAll('.prose, div[dir="auto"]');
      return pickLastNonEmptyNode(pplxNodes);
    }
    case 'qwen': {
      const monacoNodes = document.querySelectorAll('.monaco-editor:not(#codebridge-sidebar *), .monaco-scrollable-element:not(#codebridge-sidebar *)');
      const lastMonaco = pickLastNonEmptyNode(monacoNodes);
      if (lastMonaco) {
        const parentTurn = lastMonaco.closest('[class*="message-item"], [class*="chat-item"], [class*="response"], [class*="markdown"], .markdown-body, .prose');
        if (parentTurn) return parentTurn;
      }
      const qwenNodes = document.querySelectorAll('[class*="qwen-chat-message-assistant"], [class*="assistant-message"], .markdown-body, [class*="message-content"], .prose');
      const validQwen = pickLastNonEmptyNode(qwenNodes);
      if (validQwen) return validQwen;
      if (lastMonaco) return lastMonaco.parentElement ? lastMonaco.parentElement : lastMonaco;
      break;
    }
    case 'kimi': {
      const kimiNodes = document.querySelectorAll('[class*="segment-content"], [class*="markdown-body"], .markdown');
      return pickLastNonEmptyNode(kimiNodes);
    }
    case 'doubao': {
      const doubaoNodes = document.querySelectorAll('[data-testid*="message_text_content"], [class*="markdown-body"], .markdown');
      return pickLastNonEmptyNode(doubaoNodes);
    }
    case 'huggingface': {
      const hfNodes = document.querySelectorAll('.prose, [class*="message"]');
      return pickLastNonEmptyNode(hfNodes);
    }
    default: {
      const topTurnContainers = document.querySelectorAll('model-response');
      if (topTurnContainers.length > 0) return topTurnContainers[topTurnContainers.length - 1];
      const geminiContainers = document.querySelectorAll('message-content, .model-response-text');
      if (geminiContainers.length > 0) {
        const lastContainer = geminiContainers[geminiContainers.length - 1];
        const parentTurn = lastContainer.closest('model-response, [class*="conversation-turn"]');
        return parentTurn ? parentTurn : lastContainer;
      }
      break;
    }
  }
  return null;
}
// --------------------------------------------------------
function extractMessageText(messageNode) {
  if (!messageNode) return "";
  let text = messageNode.innerText;
  if (!text ? true : text.trim() === "") text = messageNode.textContent ? messageNode.textContent : "";
  return text.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/\\vert\{\}/gi, PIPE_CHAR);
}
// --------------------------------------------------------
function extractPreCodeBlocksFromNode(rootNode) {
  if (!rootNode) return "";
  const preElements = rootNode.querySelectorAll('pre');
  if (preElements.length > 0) {
    let blocks = [];
    preElements.forEach(pre => {
      const codeEl = pre.querySelector('code');
      const targetEl = codeEl ? codeEl : pre;
      let raw = targetEl.innerText ? targetEl.innerText : (targetEl.textContent ? targetEl.textContent : "");
      raw = raw.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/\\vert\{\}/gi, PIPE_CHAR);
      if (raw.trim().length > 0) blocks.push(raw.trim());
    });
    const joined = blocks.join('\n');
    if (joined.includes(DELIM_OPEN)) return joined;
  }
  return "";
}
// --------------------------------------------------------
function extractCodeBlocksOnly() {
  const currentNode = findLatestAssistantMessage();
  const provider = getAIProvider();
  switch (provider) {
    case 'gemini': {
      if (!currentNode) return "";
      const extracted = extractPreCodeBlocksFromNode(currentNode);
      return extracted ? extracted : getCurrentAssistantResponseText();
    }
    case 'chatgpt': {
      let viewerEls = currentNode ? Array.from(currentNode.querySelectorAll('[class*="ViewerContent-"], pre, .cm-content')) : [];
      if (viewerEls.length === 0) {
        viewerEls = Array.from(document.querySelectorAll('[class*="ViewerContent-"]:not(#codebridge-sidebar *)'));
      }
      if (viewerEls.length > 0) {
        let blocks = [];
        viewerEls.forEach(el => {
          if (el.tagName.toLowerCase() === 'pre' && el.querySelector('[class*="ViewerContent-"], .cm-content')) return;
          const innerTarget = el.querySelector('[class*="ViewerContent-"], code, .cm-content');
          const targetEl = innerTarget ? innerTarget : el;
          let raw = targetEl.innerText ? targetEl.innerText : (targetEl.textContent ? targetEl.textContent : "");
          raw = raw.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/\\vert\{\}/gi, PIPE_CHAR);
          if (raw.trim().length > 0) blocks.push(raw.trim());
        });
        const joined = blocks.join('\n');
        if (joined.includes(DELIM_OPEN)) return joined;
      }
      return getCurrentAssistantResponseText();
    }
    case 'claude': {
      let claudeCodeEls = currentNode ? Array.from(currentNode.querySelectorAll('.code-block__code, [class*="code-block__code"], pre')) : [];
      if (claudeCodeEls.length === 0) {
        claudeCodeEls = Array.from(document.querySelectorAll('.code-block__code:not(#codebridge-sidebar *), [class*="code-block__code"]:not(#codebridge-sidebar *)'));
      }
      if (claudeCodeEls.length > 0) {
        let blocks = [];
        claudeCodeEls.forEach(el => {
          if (el.tagName.toLowerCase() === 'pre' && el.querySelector('.code-block__code, [class*="code-block__code"]')) return;
          const codeEl = el.querySelector('code');
          const targetEl = codeEl ? codeEl : el;
          let raw = targetEl.innerText ? targetEl.innerText : (targetEl.textContent ? targetEl.textContent : "");
          raw = raw.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/\\vert\{\}/gi, PIPE_CHAR);
          if (raw.trim().length > 0) blocks.push(raw.trim());
        });
        const joined = blocks.join('\n');
        if (joined.includes(DELIM_OPEN)) return joined;
      }
      return getCurrentAssistantResponseText();
    }
    case 'qwen': {
      const scopeNode = currentNode ? currentNode : document;
      const codeBlocks = Array.from(scopeNode.querySelectorAll('.monaco-editor:not(#codebridge-sidebar *), pre:not(#codebridge-sidebar *)'));
      if (codeBlocks.length > 0) {
        let blocks = [];
        codeBlocks.forEach(block => {
          if (block.tagName.toLowerCase() === 'pre' && block.querySelector('.monaco-editor')) return;
          const viewLinesContainer = block.querySelector('.view-lines');
          if (viewLinesContainer) {
            const lineEls = Array.from(viewLinesContainer.querySelectorAll('.view-line'));
            if (lineEls.length > 0) {
              lineEls.sort((a, b) => (parseFloat(a.style.top) ? parseFloat(a.style.top) : 0) - (parseFloat(b.style.top) ? parseFloat(b.style.top) : 0));
              const linesText = lineEls.map(l => (l.innerText ? l.innerText : (l.textContent ? l.textContent : "")).replace(/\u00A0/g, ' ')).join('\n');
              if (linesText.trim().length > 0) blocks.push(linesText.trim());
              return;
            }
          }
          const codeEl = block.querySelector('code');
          const targetEl = codeEl ? codeEl : block;
          let raw = targetEl.innerText ? targetEl.innerText : (targetEl.textContent ? targetEl.textContent : "");
          raw = raw.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/\\vert\{\}/gi, PIPE_CHAR);
          if (raw.trim().length > 0) blocks.push(raw.trim());
        });
        const joined = blocks.join('\n');
        if (joined.includes(DELIM_OPEN)) return joined;
      }
      return getCurrentAssistantResponseText();
    }
    case 'deepseek':
    case 'perplexity':
    case 'kimi':
    case 'doubao':
    case 'huggingface': {
      if (!currentNode) return "";
      const extracted = extractPreCodeBlocksFromNode(currentNode);
      return extracted ? extracted : getCurrentAssistantResponseText();
    }
    default: {
      if (!currentNode) return "";
      const extracted = extractPreCodeBlocksFromNode(currentNode);
      return extracted ? extracted : getCurrentAssistantResponseText();
    }
  }
}
// --------------------------------------------------------
function cleanExtractedCode(str) {
  if (!str) return "";
  let s = str.replace(/\r\n/g, '\n').replace(/\\vert\{\}/gi, PIPE_CHAR);
  const uiHeaderTokens = ["Copy\\s*code", "Copied!", "Use\\s*code\\s*with\\s*caution\\.?", "content_copy", "download"].join(OR_OP);
  const langTokens = ["javascript", "js", "plaintext", "plain\\s*text", "text", "typescript", "ts", "html", "css", "json", "python", "py", "bash", "sh", "shell", "sql", "xml", "yaml", "yml", "markdown", "md", "gas", "appsscript", "c", "cpp", "csharp", "java", "php", "ruby", "go", "rust"].join(OR_OP);
  const uiFooterTokens = ["Use\\s*code\\s*with\\s*caution\\.?", "Copy\\s*code", "Copied!"].join(OR_OP);
  const uiHeaderRegex = new RegExp("^[ \\t]*(?:" + uiHeaderTokens + ")[ \\t]*\\n+", "gim");
  const langLabelRegex = new RegExp("^\\s*(?:" + langTokens + ")(?:[ \\t]+Copy\\s*code)?[ \\t]*\\n+", "i");
  const uiFooterRegex = new RegExp("\\n+[ \\t]*(?:" + uiFooterTokens + ")[ \\t]*$", "i");
  s = s.replace(/^\s*```[^\n]*\n?/gm, '').replace(/\n?\s*```\s*$/gm, '');
  s = s.replace(uiHeaderRegex, '').replace(langLabelRegex, '').replace(uiFooterRegex, '');
  return s.trim();
}
// --------------------------------------------------------
function getCurrentAssistantResponseText() {
  const currentNode = findLatestAssistantMessage();
  if (currentNode) {
    const text = extractMessageText(currentNode);
    if (text && text.trim().length > 0) {
      latestResponseText = text;
      return text;
    }
  }
  return latestResponseText ? latestResponseText : "";
}
// --------------------------------------------------------
function isAIStreaming() {
  const stopSelectors = [
    'button[aria-label*="Stop" i]',
    'div[aria-label*="Stop" i][role="button"]',
    'button[data-testid*="stop" i]',
    '.stop-button',
    'mat-icon[fonticon="stop"]'
  ];
  for (const sel of stopSelectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return true;
  }
  return false;
}
// --------------------------------------------------------
// RPA & MULTI-AGENT ROUTING PROCESSOR
// --------------------------------------------------------
function processRPAAndAgents(stableText) {
  if (!isSystemActive) return;
  if (typeof window.processedAgents === 'undefined') window.processedAgents = new Set();
  if (typeof window.lastNudgedMessage === 'undefined') window.lastNudgedMessage = "";
  const fileMatch = stableText.match(new RegExp("\\[REQ" + ":\\s*(.+?)\\]"));
  if (fileMatch && fileMatch[1]) {
    const reqHash = "REQ_" + fileMatch[1].trim() + "_" + stableText.length;
    if (!window.processedAgents.has(reqHash)) {
      window.processedAgents.add(reqHash);
      let targetPath = fileMatch[1].trim();
      if (!fileHandles[targetPath]) {
        const possibleKeys = Object.keys(fileHandles).filter(k => k === targetPath ? true : k.endsWith('/' + targetPath));
        if (possibleKeys.length === 1) targetPath = possibleKeys[0];
      }
      if (fileHandles[targetPath]) {
        statusDiv.textContent = `Uploading ${targetPath}...`;
        sendToChat([targetPath], true);
      } else {
        statusDiv.textContent = `File not found in workspace: ${targetPath}`;
      }
    }
  }
  const agentStopLookahead = ["\\[@", "\\[BROADCAST\\]", "$"].join(OR_OP);
  const agentRegex = new RegExp("\\[@([^\\]]+)\\]\\s*([\\s\\S]*?)(?=" + agentStopLookahead + ")", "g");
  let agentMatch;
  while ((agentMatch = agentRegex.exec(stableText)) !== null) {
    const targetRole = agentMatch[1].trim();
    const messagePayload = agentMatch[2].trim();
    if (!messagePayload) continue;
    const uniqueHash = "DM_" + targetRole + "_" + messagePayload.substring(0, 50) + "_" + messagePayload.length;
    if (!window.processedAgents.has(uniqueHash)) {
      window.processedAgents.add(uniqueHash);
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          action: "route_message",
          workspace: directoryHandle ? directoryHandle.name : "default",
          sourceRole: currentAgentRole ? currentAgentRole : "System",
          targetRole: targetRole,
          message: messagePayload
        }, (res) => {
          if (res && res.success) statusDiv.textContent = `Routed to ${targetRole}`;
          else {
            window.processedAgents.delete(uniqueHash);
            statusDiv.textContent = `Failed: ${targetRole} offline`;
          }
        });
      }
    }
  }
  const bcStopLookahead = ["\\[@", "$"].join(OR_OP);
  const broadcastRegex = new RegExp("\\[BROADCAST\\]\\s*([\\s\\S]*?)(?=" + bcStopLookahead + ")", "g");
  let bMatch;
  while ((bMatch = broadcastRegex.exec(stableText)) !== null) {
    const payload = bMatch[1].trim();
    if (!payload) continue;
    const hash = "BC_" + payload.substring(0, 50) + "_" + payload.length;
    if (!window.processedAgents.has(hash)) {
      window.processedAgents.add(hash);
      triggerSystemBroadcast(payload);
    }
  }
  const webRegex = new RegExp("\\[WEB_" + "CMD:\\s*(.+?)\\s*" + ESC_PIPE + "\\s*(.+?)\\s*" + ESC_PIPE + "\\s*(.+?)\\]", "g");
  let webMatch;
  while ((webMatch = webRegex.exec(stableText)) !== null) {
    const targetUrl = webMatch[1].trim();
    const command = webMatch[2].trim();
    const selector = webMatch[3].trim();
    const uniqueHash = "WEB_" + targetUrl + "_" + command + "_" + selector;
    if (!window.processedAgents.has(uniqueHash)) {
      window.processedAgents.add(uniqueHash);
      statusDiv.textContent = `Executing RPA on ${targetUrl}...`;
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: "web_command", url: targetUrl, command: command, selector: selector }, (res) => {
          if (res && res.success) {
            sendToChat(null, true, `[From:WebWorker (${targetUrl})]\nSUCCESS. Data:\n${res.data}`);
          } else {
            const errStr = res && res.error ? res.error : 'Tab not active or URL incorrect.';
            sendToChat(null, true, `[From:WebWorker (${targetUrl})]\nFAILED: ${errStr}`);
          }
        });
      }
    }
  }
  if (currentAgentRole && document.getElementById('cb-agent-toggle').checked && stableText !== window.lastNudgedMessage) {
    window.lastNudgedMessage = stableText;
    const hasRouting = new RegExp("\\[@([^\\]]+)\\]").test(stableText);
    const hasWebCmd = new RegExp("\\[WEB_" + "CMD:").test(stableText);
    const hasBroadcast = new RegExp("\\[BROADCAST\\]").test(stableText);
    const hasCode = stableText.includes(START_MARKER);
    const hasFileReq = new RegExp("\\[REQ" + ":\\s*(.+?)\\]").test(stableText);
    const hasSystemAck = [stableText.includes('[IN' + 'IT:'), stableText.includes('[SYS' + 'TEM'), stableText.includes('Rollcall')].some(Boolean);
    const anyValidAction = [hasRouting, hasCode, hasFileReq, hasSystemAck, hasWebCmd, hasBroadcast].some(Boolean);
    const anyResetAction = [hasRouting, hasCode, hasWebCmd, hasBroadcast].some(Boolean);
    if (!anyValidAction) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        document.getElementById('cb-agent-toggle').checked = false;
        sendToChat(null, true, "[SYSTEM HALT]: 3 consecutive format errors. Auto-Agent disabled.");
        consecutiveErrors = 0;
      } else {
        sendToChat(null, true, "[SYSTEM]: Missing command or code. Use [@Role] or [BROADCAST].");
      }
    } else if (anyResetAction) {
      consecutiveErrors = 0;
    }
  }
}
// --------------------------------------------------------
// DOM MUTATION OBSERVER (WITH NEW-CHAT TO SESSION-URL MIGRATION)
// --------------------------------------------------------
function startObserver() {
  if (chatObserver) return;
  chatObserver = new MutationObserver(() => {
    if (currentUrlPath !== window.location.pathname) {
      const oldPath = currentUrlPath;
      const newPath = window.location.pathname;
      currentUrlPath = newPath;
      if (!isSpecificSessionUrl(oldPath) && isSpecificSessionUrl(newPath) && directoryHandle) {
        localStorage.setItem('cb-workspace-url-' + newPath, directoryHandle.name);
        if (currentAgentRole) localStorage.setItem('cb-role-url-' + newPath, currentAgentRole);
        syncSessionUrlFile(directoryHandle);
      } else {
        attemptAutoLoad();
      }
    }
    if (forcedTabTitle && document.title !== forcedTabTitle) document.title = forcedTabTitle;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (isAIStreaming()) {
        statusDiv.textContent = "⏳ AI is generating...";
        return;
      }
      const textToProcess = getCurrentAssistantResponseText();
      if (textToProcess && textToProcess.trim().length > 0) {
        try { processRPAAndAgents(textToProcess); } catch (err) {}
        try {
          const cbAutoPull = document.getElementById('cb-auto-pull');
          const codeOnly = extractCodeBlocksOnly();
          if (cbAutoPull && cbAutoPull.checked && codeOnly.includes(START_MARKER) && codeOnly.includes(END_MARKER)) {
            const pullHash = "AUTOPULL_" + codeOnly.length + "_" + codeOnly.substring(0, 60);
            if (window.lastAutoPullHash !== pullHash) {
              window.lastAutoPullHash = pullHash;
              statusDiv.textContent = "Auto-Pulling Output...";
              btnPull.click();
            }
          }
        } catch (err) {}
        try {
          const cbAutoAnswer = document.getElementById('cb-auto-answer');
          if (cbAutoAnswer && cbAutoAnswer.checked) {
            const reqRegex = /\[REQ:([^\]]+)\]/g;
            let reqMatch;
            let requestedFiles = [];
            while ((reqMatch = reqRegex.exec(textToProcess)) !== null) requestedFiles.push(reqMatch[1].trim());
            if (requestedFiles.length > 0 && directoryHandle) {
              const reqHash = "REQ_" + requestedFiles.join(PIPE_CHAR) + "_" + textToProcess.length;
              if (window.lastProcessedReqHash !== reqHash) {
                window.lastProcessedReqHash = reqHash;
                statusDiv.textContent = `Auto-Answering: Fetching ${requestedFiles.length} file(s)...`;
                let filesToAttach = [];
                for (let targetPath of requestedFiles) {
                  if (!fileHandles[targetPath]) {
                    const possibleKeys = Object.keys(fileHandles).filter(k => k === targetPath ? true : k.endsWith('/' + targetPath));
                    if (possibleKeys.length === 1) targetPath = possibleKeys[0];
                  }
                  if (fileHandles[targetPath]) filesToAttach.push(targetPath);
                }
                if (filesToAttach.length > 0) sendToChat(filesToAttach, true, null);
                else statusDiv.textContent = `File(s) not found in workspace: ${requestedFiles.join(', ')}`;
              }
            }
          }
        } catch (err) {}
      }
    }, 1800);
  });
  chatObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}
startObserver();
// --------------------------------------------------------
// FUZZY PATCH MATCHER & VALIDATION ENGINE (SAFE CALLBACK REPLACE)
// --------------------------------------------------------
function fuzzyReplace(content, search, replace) {
  let c = content.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
  let s = search.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\vert\{\}/gi, PIPE_CHAR);
  let r = replace.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\vert\{\}/gi, PIPE_CHAR);
  s = s.replace(/^\s*```[a-z]*\n?/gim, '').replace(/\n?\s*```\s*$/gim, '').trim();
  r = r.replace(/^\s*```[a-z]*\n?/gim, '').replace(/\n?\s*```\s*$/gim, '').trim();
  if (c.includes(s)) return c.replace(s, () => r);
  if (s.trim() !== "" && c.includes(s.trim())) return c.replace(s.trim(), () => r.trim());
  const decodeHTML = (str) => str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let normC = decodeHTML(c);
  let normS = decodeHTML(s);
  let normR = decodeHTML(r);
  if (normC.includes(normS)) return normC.replace(normS, () => normR);
  if (normS.trim() !== "" && normC.includes(normS.trim())) return normC.replace(normS.trim(), () => normR.trim());
  const escapeRegEx = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sepTokens = ["\\/\\/", "#", "\\/\\*", "--"].join(OR_OP);
  const sepRegex = new RegExp("^(?:" + sepTokens + ")\\s*[-=_*]{4,}\\s*(?:\\*\\/)?$");
  const stripSeparators = (lines) => lines.filter(l => !sepRegex.test(l));
  let linesSearch = stripSeparators(normS.split('\n').map(l => l.trim()).filter(l => l.length > 0));
  if (linesSearch.length > 0) {
    let flexLinePattern = linesSearch.map(escapeRegEx).join('\\s+');
    try {
      let lineRegex = new RegExp(flexLinePattern);
      let match = normC.match(lineRegex);
      if (match) return normC.replace(match[0], () => normR);
    } catch (e) {}
  }
  let ultraSearch = linesSearch.join('').replace(/\s+/g, '').split('').map(escapeRegEx).join('\\s*');
  if (ultraSearch.length > 0) {
    try {
      let ultraRegex = new RegExp(ultraSearch);
      let ultraMatch = normC.match(ultraRegex);
      if (ultraMatch) return normC.replace(ultraMatch[0], () => normR);
    } catch (e) {}
  }
  return null;
}
// --------------------------------------------------------
function isValidTargetFilename(path) {
  if (!path ? true : path.length > 180) return false;
  const invalidCharsRegex = new RegExp("[()\\[\\]{}<>*?\"" + ESC_PIPE + "'`$!;]");
  if (invalidCharsRegex.test(path)) return false;
  if (/\s/.test(path)) return false;
  const lower = path.toLowerCase();
  if (['path/to/filename.ext', 'filename.ext', 'folder/subfolder/file.js', 'full/path/to/file.ext', 'path/file.ext', 'path/file.js', 'path/file.html', 'path/file.py', 'path/file.css', 'file.js', 'filename', 'path'].includes(lower)) return false;
  if (/^file\d*\.js$/i.test(lower)) return false;
  const baseName = path.split('/').pop();
  return baseName.includes('.');
}
// --------------------------------------------------------
function isPatchAlreadyInContent(content, replaceStr) {
  if (!content ? true : !replaceStr) return false;
  const norm = (str) => str.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
  const normR = norm(replaceStr);
  if (!normR) return false;
  return norm(content).includes(normR);
}
// --------------------------------------------------------
// PULL AI OUTPUT & SAVE ENGINE (WITH PATCH DEDUPLICATION & ALREADY-APPLIED CHECK)
// --------------------------------------------------------
let pendingWrites = [];
let isPullRunning = false;
btnPull.addEventListener('click', async () => {
  if (isPullRunning) return;
  isPullRunning = true;
  try {
    const manualInputEl = document.getElementById('cb-manual-pull-input');
    const manualText = manualInputEl ? manualInputEl.value.trim() : "";
    const isManualOverride = manualText.length > 0;
    statusDiv.textContent = isManualOverride ? "Scanning manual input..." : "Scanning response...";
    const fullResponseText = isManualOverride ? manualText : getCurrentAssistantResponseText();
    if (!fullResponseText ? true : fullResponseText.trim() === "") {
      return statusDiv.textContent = "No text captured yet. Let AI finish typing or paste into manual box.";
    }
    processRPAAndAgents(fullResponseText);
    const textToProcess = (isManualOverride ? manualText : extractCodeBlocksOnly()).replace(/\r\n/g, '\n');
    const parsed = parseAiFileBlocks(textToProcess, true);
    if (parsed.hasErrors) {
      const truncatedList = parsed.incomplete.join(', ');
      statusDiv.textContent = `❌ Truncation detected! Incomplete file(s): ${truncatedList} — Halting save.`;
      if (document.getElementById('cb-agent-toggle').checked) {
        consecutiveErrors++;
        if (consecutiveErrors < 3) {
          sendToChat(null, true, `⚠️ **Truncated Output Detected**\nThe following file(s) had a START tag without a matching END tag: \`${truncatedList}\`. Please output the complete file(s) inside matching \`${START_MARKER} ... ${DELIM_CLOSE}\` and \`${END_MARKER} ... ${DELIM_CLOSE}\` tags.`);
        }
      }
      return;
    }
    const extractedEntries = Object.entries(parsed.files);
    if (extractedEntries.length === 0) {
      if (document.getElementById('cb-agent-toggle').checked) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          document.getElementById('cb-agent-toggle').checked = false;
          return sendToChat(null, true, "[SYSTEM HALT]: Infinite error loop detected. Auto-Agent disabled.");
        }
        statusDiv.textContent = "Auto-Agent: Missing file start/end markers.";
        return sendToChat(null, true, autoAgentPrompts.noCode);
      }
      return statusDiv.textContent = `No valid ${START_MARKER} ... ${END_MARKER} blocks found.`;
    }
    const regexScripts = document.getElementById('cb-regex').value.split('\n').filter(line => line.includes(PIPE_CHAR));
    pendingWrites = [];
    let partialFails = 0;
    let notFoundFails = 0;
    let unchangedFiles = [];
    let failedPatchFiles = [];
    let diffDisplay = "";
    const commentPrefix = buildCommentPrefixPattern();
    const commentSuffix = buildCommentSuffixPattern();
    for (let i = 0; i < extractedEntries.length; i++) {
      let rawPath = extractedEntries[i][0].trim();
      let cleanPath = rawPath.replace(/^[\/*#%<\s]+/, '').replace(/[\/*#%>\s`]+$/, '').trim();
      let sectionContent = extractedEntries[i][1].replace(/\r\n/g, '\n');
      let targetHandle = fileHandles[cleanPath] ? fileHandles[cleanPath] : fileHandles[rawPath];
      let targetPath = targetHandle ? (fileHandles[cleanPath] ? cleanPath : rawPath) : cleanPath;
      if (!targetHandle) {
        const strippedName = targetPath.replace(new RegExp("(?:\\s*\\(\\d+\\)" + OR_OP + "_\\d+)(\\.[^.]+)$"), '$1');
        const baseName = targetPath.split('/').pop();
        const possibleKeys = Object.keys(fileHandles).filter(k =>
          [k === targetPath, k.endsWith('/' + targetPath), k === strippedName, k.endsWith('/' + strippedName), k.split('/').pop() === baseName].some(Boolean)
        );
        if (possibleKeys.length >= 1) {
          targetPath = possibleKeys[0];
          targetHandle = fileHandles[targetPath];
        }
      }
      let isNewFile = false;
      if (!targetHandle) {
        try {
          const parts = targetPath.split('/');
          const fileName = parts.pop();
          let currentDir = directoryHandle;
          for (const folder of parts) {
            if (folder.trim() === '') continue;
            currentDir = await currentDir.getDirectoryHandle(folder, { create: true });
          }
          targetHandle = await currentDir.getFileHandle(fileName, { create: true });
          fileHandles[targetPath] = targetHandle;
          isNewFile = true;
        } catch (err) {
          notFoundFails++;
          continue;
        }
      }
      if (targetHandle) {
        try {
          let existingWrite = pendingWrites.find(w => w.targetPath === targetPath);
          let currentContent = existingWrite ? existingWrite.currentContent : (isNewFile ? "" : await (await targetHandle.getFile()).text());
          let originalContent = existingWrite ? existingWrite.originalContent : currentContent;
          let shouldWrite = false;
          let appliedBlockPatches = [];
          const patchOldLineRegex = new RegExp("^" + commentPrefix + PATCH_OLD_MARKER + commentSuffix + "$", "m");
          const patchNewLineRegex = new RegExp("^" + commentPrefix + PATCH_NEW_MARKER + commentSuffix + "$", "m");
          const patchEndLineRegex = new RegExp("^" + commentPrefix + PATCH_END_MARKER + commentSuffix + "$", "m");
          const hasPatchMarkers = patchOldLineRegex.test(sectionContent) && patchNewLineRegex.test(sectionContent) && patchEndLineRegex.test(sectionContent);
          if (hasPatchMarkers) {
            const blockRegex = new RegExp(
              "^" + commentPrefix + PATCH_OLD_MARKER + commentSuffix + "\\n([\\s\\S]*?)\\n" + commentPrefix + PATCH_NEW_MARKER + commentSuffix + "\\n([\\s\\S]*?)\\n" + commentPrefix + PATCH_END_MARKER + commentSuffix + "$",
              "gm"
            );
            let patchMatch;
            let appliedCount = 0;
            let alreadyAppliedCount = 0;
            let foundBlocks = 0;
            const seenPatches = new Set();
            while ((patchMatch = blockRegex.exec(sectionContent)) !== null) {
              let searchStr = cleanExtractedCode(patchMatch[1]);
              let replaceStr = cleanExtractedCode(patchMatch[2]);
              const sig = searchStr + "\n<===>\n" + replaceStr;
              if (seenPatches.has(sig)) continue;
              seenPatches.add(sig);
              foundBlocks++;
              const replacedContent = fuzzyReplace(currentContent, searchStr, replaceStr);
              if (replacedContent !== null) {
                appliedBlockPatches.push({ search: searchStr, replace: replaceStr });
                currentContent = replacedContent;
                appliedCount++;
              } else if (replaceStr && isPatchAlreadyInContent(currentContent, replaceStr)) {
                alreadyAppliedCount++;
              } else {
                partialFails++;
                if (!failedPatchFiles.includes(targetPath)) failedPatchFiles.push(targetPath);
              }
            }
            if (appliedCount > 0) shouldWrite = true;
            else if (alreadyAppliedCount > 0 && !unchangedFiles.includes(targetPath)) unchangedFiles.push(targetPath);
            if (foundBlocks === 0) {
              partialFails++;
              if (!failedPatchFiles.includes(targetPath)) failedPatchFiles.push(targetPath);
            }
          } else {
            const extracted = cleanExtractedCode(sectionContent);
            if (extracted && extracted.length > 0) {
              currentContent = extracted;
              shouldWrite = true;
            }
          }
          if (shouldWrite && currentContent.trim().length > 0) {
            let nonEmptyLines = currentContent
              .replace(/\r\n/g, '\n')
              .split('\n')
              .filter(line => line.trim().length > 0);
            const alreadyHasMarkers = nonEmptyLines.some(l => l.includes(START_MARKER)) && nonEmptyLines.some(l => l.includes(END_MARKER));
            if (targetPath.endsWith('.json')) {
              const cleanJsonLines = nonEmptyLines.filter(line => !line.includes(START_MARKER) && !line.includes(END_MARKER));
              currentContent = cleanJsonLines.join('\n');
            } else if (alreadyHasMarkers) {
              currentContent = nonEmptyLines.join('\n');
            } else {
              const startComment = getCommentWrappedDelimiter("START", targetPath);
              const endComment = getCommentWrappedDelimiter("END", targetPath);
              currentContent = `${startComment}\n${nonEmptyLines.join('\n')}\n${endComment}`;
            }
            regexScripts.forEach(line => {
              const parts = line.split(PIPE_CHAR);
              if (parts.length > 1) currentContent = currentContent.replace(new RegExp(parts[0], 'g'), () => parts[1]);
            });
            const normOrig = originalContent.replace(/\r\n/g, '\n').trim();
            const normCurr = currentContent.replace(/\r\n/g, '\n').trim();
            if (!isNewFile && normOrig === normCurr) {
              if (!unchangedFiles.includes(targetPath)) unchangedFiles.push(targetPath);
            } else {
              const patch = generateGitPatch(targetPath, originalContent, currentContent, appliedBlockPatches);
              diffDisplay += patch + "\n";
              const isPatchMode = appliedBlockPatches.length > 0;
              const changesCount = isPatchMode ? appliedBlockPatches.length : 1;
              if (existingWrite) {
                existingWrite.currentContent = currentContent;
                existingWrite.patch += patch;
                existingWrite.changesCount += changesCount;
                if (isPatchMode) existingWrite.isPatchMode = true;
              } else {
                pendingWrites.push({ targetHandle, targetPath, originalContent, currentContent, isNewFile, isPatchMode, patch, changesCount });
              }
            }
          }
        } catch (err) {}
      }
    }
    window.lastUnchangedFiles = unchangedFiles;
    window.lastFailedPatchFiles = failedPatchFiles;
    if (pendingWrites.length > 0) {
      if (isManualOverride && partialFails === 0 && manualInputEl) manualInputEl.value = "";
      if (document.getElementById('cb-diff-toggle').checked) {
        document.getElementById('cb-diff-content').textContent = diffDisplay;
        diffModal.style.display = 'flex';
      } else {
        await executePendingWrites();
      }
      return;
    }
    await finalizePullReport([], unchangedFiles, failedPatchFiles, notFoundFails);
  } catch (pullErr) {
    statusDiv.textContent = `❌ Pull Error: ${pullErr.message}`;
  } finally {
    isPullRunning = false;
  }
});
// --------------------------------------------------------
document.getElementById('cb-btn-cancel-diff').addEventListener('click', () => {
  diffModal.style.display = 'none';
  pendingWrites = [];
  statusDiv.textContent = "Cancelled.";
});
document.getElementById('cb-btn-confirm-diff').addEventListener('click', () => {
  diffModal.style.display = 'none';
  executePendingWrites();
});
// --------------------------------------------------------
function dispatchPullReportToChat(reportLines, failedFiles) {
  const filesToAttach = (failedFiles ? failedFiles : []).filter(p => Boolean(fileHandles[p]));
  let fullReportMsg = reportLines.join('\n');
  if (filesToAttach.length > 0) {
    fullReportMsg += "\nAttached the mismatched file(s). Please build the proper change matching the exact lines from the attached file(s).";
  }
  sendToChat(filesToAttach, true, fullReportMsg);
}
// --------------------------------------------------------
async function finalizePullReport(savedWrites, unchangedList, failedList, notFoundCount) {
  const statusParts = [];
  const tooltipParts = [];
  let anyNewFileCreated = false;
  savedWrites.forEach(w => {
    if (w.isNewFile) {
      anyNewFileCreated = true;
      statusParts.push(`🆕 ${w.targetPath} (created)`);
      tooltipParts.push(`${w.targetPath}: created`);
    } else if (w.isPatchMode) {
      const label = w.changesCount === 1 ? "1 patch" : `${w.changesCount} patches`;
      statusParts.push(`📄 ${w.targetPath} (${label})`);
      tooltipParts.push(`${w.targetPath}: ${label} applied`);
    } else {
      statusParts.push(`📄 ${w.targetPath} (full file)`);
      tooltipParts.push(`${w.targetPath}: full file replaced`);
    }
  });
  unchangedList.forEach(p => {
    statusParts.push(`⏭️ ${p} (unchanged)`);
    tooltipParts.push(`${p}: unchanged`);
  });
  failedList.forEach(p => {
    statusParts.push(`⚠️ ${p} (patch mismatch)`);
    tooltipParts.push(`${p}: patch mismatch`);
  });
  if (anyNewFileCreated && directoryHandle) await loadFilesFromHandle(directoryHandle);
  if (statusParts.length === 0) {
    statusDiv.textContent = notFoundCount > 0 ? "❌ Target file(s) could not be created or found." : "❌ No valid code changes found.";
    return;
  }
  window.lastPullReportLines = statusParts;
  window.lastPullFailedFiles = failedList;
  const headerTitle = savedWrites.length > 0
    ? `✅ Saved (${savedWrites.length} file${savedWrites.length === 1 ? '' : 's'}):`
    : (failedList.length > 0 ? `⚠️ Patch Mismatch (${failedList.length}):` : `⏭️ Already up-to-date:`);
  const headerColor = savedWrites.length > 0 ? "#a5d6a7" : (failedList.length > 0 ? "#ffb74d" : "#4fc3f7");
  const sendBtnHtml = `<button id="cb-btn-send-report" title="Send this report & any mismatched files to AI" style="background:#0288d1; color:#fff; border:none; padding:2px 6px; font-size:10px; border-radius:3px; cursor:pointer; margin-left:6px;">📤 Send Report</button>`;
  const summaryHtml = `<div style="display:flex; justify-content:space-between; align-items:center;"><span style="color:${headerColor}; font-weight:bold;">${headerTitle}</span>${sendBtnHtml}</div>` + statusParts.join('<br>');
  statusDiv.style.textAlign = 'left';
  statusDiv.style.lineHeight = '1.4';
  statusDiv.setAttribute('data-pull-summary', summaryHtml);
  statusDiv.innerHTML = summaryHtml;
  statusDiv.title = tooltipParts.join('\n');
  const sendReportBtn = document.getElementById('cb-btn-send-report');
  if (sendReportBtn) {
    sendReportBtn.addEventListener('click', () => {
      dispatchPullReportToChat(window.lastPullReportLines, window.lastPullFailedFiles);
    });
  }
  const cbAutoAnswer = document.getElementById('cb-auto-answer');
  if (cbAutoAnswer && cbAutoAnswer.checked) {
    if (failedList.length > 0 && savedWrites.length === 0) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        cbAutoAnswer.checked = false;
        sendToChat(null, true, "[SYSTEM HALT]: 3 consecutive patch mismatches. Auto-Answer disabled.");
        return;
      }
    } else {
      consecutiveErrors = 0;
    }
    dispatchPullReportToChat(statusParts, failedList);
  }
}
// --------------------------------------------------------
async function executePendingWrites() {
  const backupToggleLocal = document.getElementById('cb-backup-toggle').checked;
  const patchToggleLocal = document.getElementById('cb-patch-toggle').checked;
  let sessionDirHandle = null;
  let globalPatchContent = "";
  for (const writeObj of pendingWrites) {
    if (patchToggleLocal) globalPatchContent += writeObj.patch;
    if (!writeObj.isNewFile && backupToggleLocal && writeObj.originalContent.trim() !== '') {
      if (!sessionDirHandle) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupRoot = await directoryHandle.getDirectoryHandle('.anyai_backups', { create: true });
        sessionDirHandle = await backupRoot.getDirectoryHandle(`backup_${ts}`, { create: true });
      }
      const bw = await (await sessionDirHandle.getFileHandle(writeObj.targetPath.replace(/\//g, '_'), { create: true })).createWritable();
      await bw.write(writeObj.originalContent);
      await bw.close();
    }
    const writable = await writeObj.targetHandle.createWritable();
    await writable.write(writeObj.currentContent);
    await writable.close();
    fileSizes[writeObj.targetPath] = writeObj.currentContent.length;
    logAndTrackFile(writeObj.isNewFile ? "Create" : "Write", writeObj.targetPath);
  }
  if (patchToggleLocal && globalPatchContent !== "") {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const pw = await (await (await directoryHandle.getDirectoryHandle('.anyai_backups', { create: true })).getFileHandle(`backup_${ts}.patch`, { create: true })).createWritable();
      await pw.write(globalPatchContent);
      await pw.close();
    } catch (e) {}
  }
  const completedWrites = [...pendingWrites];
  pendingWrites = [];
  persistFileCheckboxState();
  const unchangedList = window.lastUnchangedFiles ? window.lastUnchangedFiles : [];
  const failedList = window.lastFailedPatchFiles ? window.lastFailedPatchFiles : [];
  await finalizePullReport(completedWrites, unchangedList, failedList, 0);
  const autoPushEl = document.getElementById('cb-autopush-toggle');
  const scriptIdEl = document.getElementById('cb-script-id');
  if (autoPushEl && autoPushEl.checked && scriptIdEl && scriptIdEl.value.trim()) {
    pushToGAS(true);
  }
}
// --------------------------------------------------------
function generateGitPatch(filePath, oldContent, newContent, patches) {
  let patch = `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n`;
  if (patches.length > 0) {
    patches.forEach(p => {
      const idx = oldContent.indexOf(p.search);
      const startLine = idx === -1 ? 1 : (oldContent.substring(0, idx).split('\n').length);
      patch += `@@ -${startLine},${p.search.split('\n').length} +${startLine},${p.replace.split('\n').length} @@\n`;
      p.search.split('\n').forEach(l => patch += `-${l}\n`);
      p.replace.split('\n').forEach(l => patch += `+${l}\n`);
    });
  } else {
    patch += `@@ -0,0 +1,${newContent.split('\n').length} @@\n`;
    newContent.split('\n').forEach(l => patch += `+${l}\n`);
  }
  return patch + '\n';
}
// <<<<=== END: content.js ===>>>>