#!/usr/bin/env bun
/**
 * tguser - Telegram user-account CLI for sending messages.
 *
 * Usage:
 *   tguser send <peer> <message>
 *
 * Environment:
 *   TG_API_ID    - Telegram API ID   (from https://my.telegram.org)
 *   TG_API_HASH  - Telegram API hash
 *
 * The first run will prompt for phone number + auth code and persist the
 * session in ~/.tguser/session so subsequent runs are non-interactive.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

const SESSION_DIR = path.join(process.env.HOME || "/tmp", ".tguser");
const SESSION_FILE = path.join(SESSION_DIR, "session");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadSession(): string {
  try {
    return fs.readFileSync(SESSION_FILE, "utf-8").trim();
  } catch {
    return "";
  }
}

function saveSession(session: string): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, session, { mode: 0o600 });
}

async function getClient(): Promise<TelegramClient> {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  if (!apiId || !apiHash) {
    console.error("Error: TG_API_ID and TG_API_HASH must be set");
    process.exit(1);
  }

  const savedSession = loadSession();
  const session = new StringSession(savedSession);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
  });

  if (!savedSession) {
    await client.start({
      phoneNumber: () => prompt("Phone number: "),
      phoneCode: () => prompt("Auth code: "),
      password: () => prompt("2FA password: "),
      onError: (err) => {
        console.error("Auth error:", err.message);
      },
    });
    saveSession(client.session.save() as unknown as string);
    console.error("Session saved to", SESSION_FILE);
  } else {
    await client.connect();
  }

  return client;
}

async function sendMessage(peer: string, message: string): Promise<void> {
  const client = await getClient();
  try {
    const result = await client.sendMessage(peer, { message });
    console.log(`Sent message id=${result.id} to ${peer}`);
  } finally {
    await client.disconnect();
  }
}

// --- CLI ---

const [, , command, ...args] = process.argv;

if (command === "send") {
  const [peer, ...messageParts] = args;
  const message = messageParts.join(" ");
  if (!peer || !message) {
    console.error("Usage: tguser send <peer> <message>");
    process.exit(1);
  }
  await sendMessage(peer, message);
} else {
  console.error("Usage: tguser send <peer> <message>");
  process.exit(1);
}
