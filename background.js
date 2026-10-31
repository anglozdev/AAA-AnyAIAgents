// <<<<=== START: background.js ===>>>>
/*
 * Copyright (C) 2026 Angel Lozano (anglozdev)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" }).catch(err => console.log("Content script not ready"));
});
let activeAgents = {}; // Format: tabId -> { workspace, role, status }
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    // REGISTER AGENTS ON TAB LOAD / ROLE CHANGE
    if (req.action === "register_role") {
        if (req.role) {
            activeAgents[sender.tab.id] = { workspace: req.workspace, role: req.role, status: req.status };
        } else {
            delete activeAgents[sender.tab.id];
        }
        sendResponse({ success: true });
        return true;
    }
    // DIRECT 1-TO-1 AGENT ROUTING ([@AgentName])
    if (req.action === "route_message") {
        chrome.tabs.query({}, (tabs) => {
            let targetTabId = null;
            // 1. Check in-memory activeAgents
            const entry = Object.entries(activeAgents).find(([id, data]) => 
                data.workspace === req.workspace && data.role === req.targetRole
            );
            if (entry) {
                targetTabId = parseInt(entry[0]);
            } else {
                // 2. Fallback: Query open tabs by forced tab title (Role - Workspace - Status)
                const matchingTab = tabs.find(tab => 
                    tab.title && tab.title.startsWith(`${req.targetRole} - ${req.workspace} - `)
                );
                if (matchingTab) targetTabId = matchingTab.id;
            }
            if (targetTabId) {
                chrome.tabs.sendMessage(targetTabId, {
                    action: "receive_agent_message",
                    sourceRole: req.sourceRole,
                    message: req.message
                }, (res) => {
                    if (chrome.runtime.lastError) {
                        delete activeAgents[targetTabId]; 
                        sendResponse({ success: false, error: "offline" });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            } else {
                sendResponse({ success: false, error: "offline" });
            }
        });
        return true;
    }
    // SILENT WORKSPACE STATUS POLLING FOR UI
    if (req.action === "get_workspace_statuses") {
        chrome.tabs.query({}, (tabs) => {
            let statuses = {};
            tabs.forEach(tab => {
                if (tab.title && tab.title.includes(` - ${req.workspace} - `)) {
                    const parts = tab.title.split(' - ');
                    if (parts.length >= 3) {
                        statuses[parts[0].trim()] = parts[2].trim();
                    }
                }
            });
            sendResponse({ success: true, statuses: statuses });
        });
        return true; 
    }
    // OPEN GAS SETUP GUIDE IN A PRIVILEGED EXTENSION TAB
    if (req.action === "open_gas_manual") {
        chrome.tabs.create({ url: chrome.runtime.getURL("gas-manual.html") });
        sendResponse({ success: true });
        return true;
    }
    // GOOGLE OAUTH 2.0 TOKEN FETCHER (POPUP WINDOW INTERCEPTOR - BYPASSES IDENTITY LOCK)
    if (req.action === "get_gas_token") {
        const clientId = req.clientId ? req.clientId.trim() : "";
        if (!clientId) {
            sendResponse({ success: false, error: "Missing Google OAuth Client ID." });
            return true;
        }
        if (globalThis.cachedGasToken && globalThis.cachedGasClientId === clientId && Date.now() < globalThis.cachedGasExpiry) {
            sendResponse({ success: true, token: globalThis.cachedGasToken });
            return true;
        }
        if (!globalThis.pendingGasAuthCallbacks) {
            globalThis.pendingGasAuthCallbacks = [];
        }
        globalThis.pendingGasAuthCallbacks.push(sendResponse);
        if (globalThis.isAuthFlowActive && globalThis.activeAuthWindowId) {
            chrome.windows.update(globalThis.activeAuthWindowId, { focused: true }).catch(() => {});
            return true;
        }
        globalThis.isAuthFlowActive = true;
        const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
        const scope = encodeURIComponent("https://www.googleapis.com/auth/script.projects");
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&prompt=consent`;
        let authTabId = null;
        let authWindowId = null;
        let isResolved = false;
        const cleanupAndResolve = (payload) => {
            if (isResolved) return;
            isResolved = true;
            globalThis.isAuthFlowActive = false;
            globalThis.activeAuthWindowId = null;
            chrome.tabs.onUpdated.removeListener(onTabUpdated);
            chrome.tabs.onRemoved.removeListener(onTabRemoved);
            const callbacks = globalThis.pendingGasAuthCallbacks.splice(0);
            callbacks.forEach(cb => {
                try { cb(payload); } catch (err) {}
            });
        };
        const onTabUpdated = (tabId, changeInfo, tab) => {
            if (tabId !== authTabId && (!tab || tab.windowId !== authWindowId)) return;
            const currentUrl = changeInfo.url || (tab && tab.url) || "";
            if (!currentUrl.startsWith(redirectUri)) return;
            chrome.tabs.remove(tabId).catch(() => {});
            try {
                const hashIndex = currentUrl.indexOf('#');
                const queryIndex = currentUrl.indexOf('?');
                const rawParams = hashIndex !== -1 ? currentUrl.substring(hashIndex + 1) : (queryIndex !== -1 ? currentUrl.substring(queryIndex + 1) : "");
                const params = new URLSearchParams(rawParams);
                const errParam = params.get('error');
                if (errParam) {
                    cleanupAndResolve({ success: false, error: `Google OAuth error: ${errParam}` });
                    return;
                }
                const accessToken = params.get('access_token');
                const expiresIn = parseInt(params.get('expires_in') || "3600", 10);
                if (!accessToken) {
                    cleanupAndResolve({ success: false, error: "No access_token returned in redirect URI." });
                    return;
                }
                globalThis.cachedGasToken = accessToken;
                globalThis.cachedGasClientId = clientId;
                globalThis.cachedGasExpiry = Date.now() + (expiresIn - 60) * 1000;
                cleanupAndResolve({ success: true, token: accessToken });
            } catch (e) {
                cleanupAndResolve({ success: false, error: e.message });
            }
        };
        const onTabRemoved = (tabId) => {
            if (tabId === authTabId && !isResolved) {
                cleanupAndResolve({ success: false, error: "OAuth popup window was closed before completing sign-in." });
            }
        };
        chrome.tabs.onUpdated.addListener(onTabUpdated);
        chrome.tabs.onRemoved.addListener(onTabRemoved);
        chrome.windows.create({ url: authUrl, type: "popup", width: 540, height: 660, focused: true }, (win) => {
            if (chrome.runtime.lastError || !win) {
                const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Failed to open OAuth popup window.";
                cleanupAndResolve({ success: false, error: errMsg });
                return;
            }
            authWindowId = win.id;
            globalThis.activeAuthWindowId = win.id;
            if (win.tabs && win.tabs.length > 0) {
                authTabId = win.tabs[0].id;
            }
        });
        return true;
    }
    // INSTANT TAB-TITLE BROADCASTING & STATUS ROLLCALL
    if (req.action === "broadcast_message") {
        chrome.tabs.query({}, (tabs) => {
            let responses = [];
            tabs.forEach(tab => {
                // Look for tabs matching: "Role - Workspace - Status"
                if (tab.id !== sender.tab.id && tab.title && tab.title.includes(` - ${req.workspace} - `)) {
                    const parts = tab.title.split(' - ');
                    if (parts.length >= 3) {
                        responses.push({ 
                            role: parts[0].trim(), 
                            status: parts[2].trim() 
                        });
                        // FIX: Physically deliver the broadcast to the target tab
                        chrome.tabs.sendMessage(tab.id, {
                            action: "receive_broadcast",
                            sourceRole: req.sourceRole,
                            message: req.message
                        }).catch(() => {}); // Catch safely in case a tab is suspended
                    }
                }
            });
            // Instantly resolve the broadcast without any timeouts
            sendResponse({ success: true, statuses: responses });
        });
        return true; 
    }
});
// <<<<=== END: background.js ===>>>>