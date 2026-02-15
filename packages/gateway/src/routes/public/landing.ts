import { Hono } from "hono";
import { WebClient } from "@slack/web-api";
import { loadCredentialsFromEnv } from "../../whatsapp/connection/auth-state";

type SlackInfo = {
  teamId: string;
  teamName: string;
  teamDomain?: string;
  botUserId: string;
  botName: string;
  dmLink: string;
};

type WhatsAppInfo = {
  number: string;
  label: string;
  link: string;
};

type LandingOptions = {
  publicGatewayUrl?: string;
  githubUrl: string;
};

const SLACK_CACHE_TTL_MS = 5 * 60 * 1000;
let slackCache: {
  value: SlackInfo | null;
  expiresAt: number;
  inFlight?: Promise<SlackInfo | null>;
} | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSlackDmLink(teamId: string, botUserId: string): string {
  const params = new URLSearchParams({ team: teamId, channel: botUserId });
  return `https://slack.com/app_redirect?${params.toString()}`;
}

async function fetchSlackInfo(): Promise<SlackInfo | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  const client = new WebClient(token);
  const auth = await client.auth.test();
  if (!auth.ok || !auth.team_id || !auth.user_id || !auth.user) {
    return null;
  }

  let teamName = auth.team ?? "Slack Workspace";
  let teamDomain: string | undefined;
  try {
    const team = await client.team.info();
    if (team.ok && team.team) {
      teamName = team.team.name || teamName;
      teamDomain = team.team.domain || undefined;
    }
  } catch {
    // Ignore team info failures; auth.test is enough to build DM link.
  }

  return {
    teamId: auth.team_id,
    teamName,
    teamDomain,
    botUserId: auth.user_id,
    botName: auth.user,
    dmLink: buildSlackDmLink(auth.team_id, auth.user_id),
  };
}

async function getSlackInfo(): Promise<SlackInfo | null> {
  const now = Date.now();
  if (slackCache && slackCache.expiresAt > now && slackCache.value) {
    return slackCache.value;
  }

  if (slackCache?.inFlight) {
    return slackCache.inFlight;
  }

  const inFlight = fetchSlackInfo()
    .then((value) => {
      slackCache = {
        value,
        expiresAt: Date.now() + SLACK_CACHE_TTL_MS,
      };
      return value;
    })
    .catch(() => {
      slackCache = { value: null, expiresAt: Date.now() + SLACK_CACHE_TTL_MS };
      return null;
    });

  slackCache = { value: null, expiresAt: now + SLACK_CACHE_TTL_MS, inFlight };
  return inFlight;
}

function getWhatsAppInfo(): WhatsAppInfo | null {
  const raw = process.env.WHATSAPP_CREDENTIALS;
  if (!raw) return null;

  const state = loadCredentialsFromEnv(raw);
  const id = state?.creds?.me?.id;
  if (!id) return null;

  const number = id.split(":")[0]?.split("@")[0] || "";
  if (!number) return null;

  const label = `+${number}`;
  return {
    number,
    label,
    link: `https://wa.me/${number}`,
  };
}

function renderLandingPage(options: {
  githubUrl: string;
  docsUrl: string;
  publicGatewayUrl?: string;
  slackInfo?: SlackInfo | null;
  whatsappInfo?: WhatsAppInfo | null;
}): string {
  const githubUrl = escapeHtml(options.githubUrl);
  const docsUrl = escapeHtml(options.docsUrl);
  const publicGateway = options.publicGatewayUrl
    ? escapeHtml(options.publicGatewayUrl)
    : "";

  const slack = options.slackInfo;
  const whatsapp = options.whatsappInfo;

  const slackStatus = slack
    ? `Workspace: ${escapeHtml(slack.teamName)}`
    : "Not configured";
  const slackBot = slack ? `Bot: ${escapeHtml(slack.botName)}` : "";
  const slackLink = slack ? slack.dmLink : "";

  const whatsappStatus = whatsapp
    ? `Number: ${escapeHtml(whatsapp.label)}`
    : "Not configured";
  const whatsappLink = whatsapp ? whatsapp.link : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lobu Gateway</title>
    <style>
      :root {
        --bg: #0f172a;
        --bg2: #111827;
        --panel: #0b1220;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #f59e0b;
        --accent2: #22d3ee;
        --border: #1f2937;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background: radial-gradient(1200px 600px at 10% 0%, #1f2937 0%, transparent 50%),
                    radial-gradient(1200px 600px at 90% 10%, #0f766e 0%, transparent 45%),
                    linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
        font-family: "Iowan Old Style", "Georgia", "Times New Roman", serif;
      }
      .wrap {
        max-width: 960px;
        margin: 0 auto;
        padding: 36px 20px 60px;
      }
      .top {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        align-items: center;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      .top a {
        color: var(--text);
        text-decoration: none;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.6);
        transition: transform 0.2s ease, border-color 0.2s ease;
      }
      .top a:hover {
        transform: translateY(-1px);
        border-color: var(--accent);
      }
      h1 {
        margin: 24px 0 8px;
        font-size: 38px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .subtitle {
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--muted);
        font-size: 16px;
        margin-bottom: 28px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
      }
      .card {
        background: rgba(11, 18, 32, 0.9);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 18px 18px 16px;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      .card h3 {
        margin: 0 0 10px;
        font-size: 18px;
        font-weight: 600;
      }
      .meta {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
        margin-bottom: 12px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        color: var(--text);
        text-decoration: none;
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(34, 211, 238, 0.2));
        font-size: 14px;
        font-weight: 600;
      }
      .button:hover { border-color: var(--accent2); }
      .footer {
        margin-top: 28px;
        color: var(--muted);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        font-size: 12px;
      }
      .kicker {
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 11px;
        color: var(--accent);
      }
      .mono {
        font-family: "SFMono-Regular", "Menlo", "Monaco", "Consolas", monospace;
        font-size: 12px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
        <a href="${docsUrl}">API Docs</a>
      </div>
      <div class="kicker">Lobu Gateway</div>
      <h1>Docs and Integrations</h1>
      <div class="subtitle">Use the API docs or connect via WhatsApp and Slack.</div>
      <div class="grid">
        <div class="card">
          <h3>API Documentation</h3>
          <div class="meta">Open the Scalar REST docs for the public gateway.</div>
          <a class="button" href="${docsUrl}">Open API Docs</a>
        </div>
        <div class="card">
          <h3>WhatsApp</h3>
          <div class="meta">${whatsappStatus}</div>
          ${whatsapp ? `<a class="button" href="${whatsappLink}" target="_blank" rel="noreferrer">Open WhatsApp Chat</a>` : ""}
        </div>
        <div class="card">
          <h3>Slack</h3>
          <div class="meta">${slackStatus}${slackBot ? `<br />${slackBot}` : ""}</div>
          ${slack ? `<a class="button" href="${slackLink}" target="_blank" rel="noreferrer">Message in Slack</a>` : ""}
        </div>
      </div>
      <div class="footer">
        ${publicGateway ? `<div class="mono">Gateway: ${publicGateway}</div>` : ""}
      </div>
    </div>
  </body>
</html>`;
}

export function createLandingRoutes(options: LandingOptions) {
  const app = new Hono();

  app.get("/", async (c) => {
    const slackInfo = await getSlackInfo();
    const whatsappInfo = getWhatsAppInfo();

    return c.html(
      renderLandingPage({
        githubUrl: options.githubUrl,
        docsUrl: "/api/docs",
        publicGatewayUrl: options.publicGatewayUrl,
        slackInfo,
        whatsappInfo,
      })
    );
  });

  return app;
}
