# AnyAIAgents (AAA) 🤖💻

**AnyAIAgents (AAA)** is a powerful Chrome extension that transforms your browser into a **mini-IDE and multi-agent orchestration hub**. 

It injects a persistent, universal sidebar into the world's top 9 AI chat platforms, allowing you to synchronize AI-generated code patches directly with your local file system, GitHub repositories, and Google Apps Script projects—all without leaving the chat tab.

## 🚀 Supported AI Platforms
AAA standardizes the coding experience across:
- **ChatGPT** (OpenAI)
- **Claude** (Anthropic)
- **Gemini** (Google)
- **DeepSeek**
- **Qwen** (Alibaba)
- **Kimi** (Moonshot)
- **Perplexity**
- **Doubao** (ByteDance)
- **HuggingFace Chat**

---

## ✨ Key Features

### 💻 Mini-IDE & Local Workspace Sync
* **File System Access:** Select a local folder on your PC. AAA reads your files and displays them in a sidebar tree.
* **Smart Prompting:** Select files via checkboxes to instantly merge and attach them to your AI prompt context.
* **Auto-Patching:** When the AI writes code, click **Pull AI Output & Save**. AAA reads the AI's diffs, previews the changes in a modal, and writes them directly to your local files.
* **Session Recovery:** The built-in `🕒 Sessions` manager tracks your AI chats across all platforms into a local `.anyai_session.md` file, allowing you to resume any multi-agent workspace instantly.

### 🐙 GitHub Integration
* Sync directly with GitHub via a Personal Access Token (PAT).
* Fetch repositories, create new branches, and pull entire file trees into your local workspace.
* Push commits directly from the browser sidebar without needing a terminal.

### ☁️ Google Apps Script (GAS) Sync
* Manage Google Workspace automation directly from your AI chat.
* **Pull GAS:** Download `.js`, `.gs`, and `.html` files from a Google Apps Script project into your local workspace.
* **Push GAS:** Upload AI-generated scripts back to Google Cloud instantly.
* *Note: AAA uses a Bring-Your-Own Client ID architecture. Click the `❓ Guide` button in the extension to set up your Google OAuth Client ID in 60 seconds.*

### 🤖 Multi-Agent Orchestration & RPA
* **Tab-to-Tab Communication:** Open multiple AI platforms in different tabs, assign them roles (e.g., `Worker_Frontend`, `Worker_Database`), and route messages between them using `[@AgentRole]`.
* **System Broadcasts:** Send `[BROADCAST]` messages to trigger actions across all active AI tabs simultaneously.
* **Web RPA:** Execute `[WEB_CMD]` commands on target web apps to extract data or interact with DOM elements dynamically.

---

## 🛠️ Installation (Developer Mode)

Since this extension requires powerful file system permissions to act as an IDE, you can install it directly from this repository:

1. Download or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing the extension files (`manifest.json`, `content.js`, etc.).
5. Pin the **AAA** icon to your Chrome toolbar.

---

## 📖 How It Works

To allow AAA to auto-apply code changes to your files, tell your AI to output code using strict START and END delimiters. (The extension can automatically inject this rule via the `-- Load Snippet --` dropdown).


<img width="2051" height="1327" alt="image" src="https://github.com/user-attachments/assets/fb7ca1e1-c314-4c43-a7f3-152e75326c6e" />

<img width="2557" height="1223" alt="image" src="https://github.com/user-attachments/assets/2aaff528-9068-4a2d-b4a2-d2ecf3d27076" />

<img width="1755" height="976" alt="image" src="https://github.com/user-attachments/assets/d5745ff3-eecf-422e-8eda-6d65ba134f2a" />
