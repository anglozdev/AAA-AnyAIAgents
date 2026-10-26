# 🤖 AnyAIAgents (AAA) – Official Documentation

Welcome to **AnyAIAgents (AAA)**, the ultimate local-first workspace sync and multi-agent orchestration sidebar for web-based AI coding assistants.

### 📑 Index
1. [⚙️ Installation (Chrome Developer Mode)](#1-️-installation-chrome-developer-mode)
2. [🎛️ Interface & Functions Overview](#2-️-interface--functions-overview)
3. [🚀 Usage Guide (Levels 1 to 4)](#3--usage-guide)

---

## 1. ⚙️ Installation (Chrome Developer Mode)
Install the extension locally in just 4 steps:

1. **Download:** Clone or download this repository as a `.zip` and extract it to a folder.
2. **Open Extensions:** Open Google Chrome and navigate to `chrome://extensions/` (or click the puzzle icon > Manage Extensions).
3. **Developer Mode:** Toggle **"Developer mode"** ON in the top-right corner.
4. **Load Unpacked:** Click the **"Load unpacked"** button in the top-left and select the extracted folder. 
5. *Tip: Click the puzzle icon and **Pin** the AAA extension to your toolbar for easy access!*

---

## 2. 🎛️ Interface & Functions Overview

Here is a breakdown of the AAA sidebar controls:

![AnyAIAgents Interface](image_893902.png)

### 🔴 Core Controls
*   **System Status (Red/Green):** Toggles the extension's background listener on or off. 
*   **Set Agent Role:** Assigns a specific persona (e.g., *Orchestrator*, *Worker_QA*) to the current browser tab.

### 📂 Workspace & Files
*   **1. Workspace/Folder:** Connects your local hard drive folder using Chrome's File System API.
*   **🕒 Sessions:** Recovers and opens past AI chat URLs linked to this workspace.
*   **Workspace Files List:** 
    *   *Checkboxes:* Select files to attach to your next prompt.
    *   *Click File Name:* Opens a menu to **Copy Path**, **Copy Content**, or **Preview in Modal** (with syntax highlighting).

### 📦 Merging & Prompting
*   **Merge to File / Attach Merged:** Combines selected files into one `.txt` file and optionally pastes them straight into the chat box.
*   **Load Snippet:** Quickly inserts common instructions or persona templates.
*   **Prompt Box:** Type your message to the AI here.

### 🚀 Automation Toggles & Actions
*   **Attach Project Map:** Appends a tree view of your workspace to the prompt.
*   **📡 Broadcast:** Sends your message to *all* active agent tabs simultaneously.
*   **🤖 Auto-Agent:** Enables autonomous looping and error-checking.
*   **2. Send Prompt / Auto-Answer:** Injects the prompt + selected files into the AI chat and clicks Send. If *Auto-Answer* is checked, AAA automatically responds if the AI requests a missing file.
*   **3. Pull AI Output & Save / Auto-Pull:** Extracts code blocks from the AI's response and saves them to your local disk. *Auto-Pull* does this instantly when the AI finishes typing.

### ☁️ Cloud Sync Modules
*   **Google Apps Script:** Enter your OAuth Client ID and Script ID to instantly **⬇ Pull GAS** or **⬆ Push GAS**.
*   **GitHub Sync:** Enter a PAT (ghp_...), select/create a repo and branch, and click **⬇ Pull Repo** or **⬆ Push Commit**.

---

## 3. 🚀 Usage Guide

### 1️⃣ Level 1: Manual Local Workspace
*Ditch copy-pasting. Manage local code directly from your AI chat tab.*
*   Click **1. Workspace/Folder** to link your project. 
*   Check the files you want the AI to read, type your prompt, and click **2. Send Prompt**.
*   When the AI generates code, click **3. Pull AI Output & Save**. AAA reads the patches, shows a Diff Preview, and saves updates directly to your hard drive.

### 2️⃣ Level 2: Cloud Sync (GitHub & GAS)
*Bypass the terminal. Push and pull code directly from the sidebar.*
*   Expand **🐙 GitHub Sync** or **☁ Google Apps Script**.
*   Enter your credentials.
*   Push or pull your entire local workspace directly to the cloud in one click. AAA automatically respects your local `.gitignore` file.

### 3️⃣ Level 3: Multi-Tab Roles (Semi-Auto)
*Assemble your AI team. Route tasks between tabs.*
*   Open 3 different AI tabs (e.g., Gemini, ChatGPT, Claude). Assign roles via the dropdown (e.g., `Orchestrator`, `Worker_Frontend`).
*   **Direct Routing:** In the Orchestrator tab, type `[@Worker_Frontend] Build the login component.` AAA instantly injects this message into the Frontend tab and sends it.

### 4️⃣ Level 4: Fully Autonomous Orchestration 
*Hands-free coding. Let the agents manage themselves.*
*   Toggle on **🤖 Auto-Agent**, **Auto-Pull**, and **Auto-Answer**.
*   **The Loop:** The Orchestrator delegates a task. The Worker generates the code and Auto-Pulls it to your hard drive. If the Worker needs context, it outputs `[REQ: index.html]` and AAA Auto-Answers with the file. Finally, the Worker routes a success message back: `[@Orchestrator] Feature complete.`