# Privacy Policy for AnyAIAgents (AAA)

**Last Updated:** October 27, 2026

AnyAIAgents ("AAA") is committed to protecting your privacy. This extension is built on a **local-first** architecture and does not collect, store, track, or sell any personal user data.

---

### 1. Data Collection & Telemetry
* **Zero Telemetry:** AnyAIAgents does not collect, log, or transmit any analytics, personal identifiers, usage stats, or tracking telemetry to external servers.
* **No Central Servers:** There are no backend servers operated by AnyAIAgents. All file reads, writes, and workspace parsing occur strictly on your local device using Chrome's native File System Access API and browser storage.

### 2. Permissions & Credentials Storage
* **Local Credentials:** Sensitive items such as your GitHub Personal Access Tokens (PAT) and Google Apps Script OAuth Client IDs are stored exclusively inside your browser's private local storage (`chrome.storage.local`). They are never uploaded to any third party.
* **Local Workspace Files:** Project files accessed via the extension remain on your local drive and are never transmitted anywhere except to the specific AI provider website or cloud repository (GitHub / Google Apps Script) that you explicitly trigger.

### 3. Third-Party Services
When you perform explicit actions (such as pushing code to GitHub or syncing with Google Apps Script), the extension connects directly from your browser client to the corresponding official APIs:
* **GitHub API (`api.github.com`):** Used solely to push commits or pull branches based on your direct interaction.
* **Google Apps Script API (`script.googleapis.com`):** Used solely to sync scripts to your personal Google Apps Script projects using your provided OAuth Client ID.

### 4. Policy Changes
If this privacy policy is updated, changes will be published directly to this page.

### 5. Contact
For questions regarding this privacy policy or the extension, open an issue on the official GitHub repository:
https://github.com/anglozdev/AAA-AnyAIAgents
