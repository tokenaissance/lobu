/**
 * History page HTML shell — serves the Preact app for viewing agent conversation history.
 */

import { settingsPageCSS } from "../settings-page-styles";

let historyPageJS = "";
try {
	// Dynamic import to handle case where bundle hasn't been generated yet
	const bundle = require("../history-page-bundle");
	historyPageJS = bundle.historyPageJS;
} catch {
	historyPageJS =
		'document.getElementById("app").textContent = "Bundle not built. Run: bun run scripts/build-history.ts";';
}

export function renderHistoryPage(agentId: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Agent History</title>
  <style>${settingsPageCSS}</style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-700 to-slate-900 p-4">
  <div class="max-w-xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style="height:calc(100vh - 2rem)">
    <div id="app" class="flex-1 flex flex-col overflow-hidden"></div>
  </div>
  <script>window.__AGENT_ID__ = ${JSON.stringify(agentId)};</script>
  <script>
    // Bootstrap session cookie from ?s= query param before app loads
    window.__sessionReady__ = (async function() {
      var params = new URLSearchParams(window.location.search);
      var sid = params.get('s');
      if (sid) {
        try {
          await fetch('/settings/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sid })
          });
        } catch(e) { /* ignore */ }
        params.delete('s');
        var remaining = params.toString();
        var newUrl = window.location.pathname + (remaining ? '?' + remaining : '');
        window.history.replaceState({}, '', newUrl);
      }
    })();
  </script>
  <script type="module">${historyPageJS}</script>
</body>
</html>`;
}
