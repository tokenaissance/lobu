/**
 * WhatsApp CLI setup - one-time QR code authentication.
 * Outputs WHATSAPP_CREDENTIALS for env var.
 */

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import {
  createAuthState,
  loadCredentialsFromEnv,
} from "./connection/auth-state";

const MAX_RETRIES = 3;

/**
 * Run WhatsApp setup - shows QR, waits for connection, outputs credentials.
 */
export async function runWhatsAppSetup(): Promise<void> {
  console.log("\n📱 WhatsApp Setup\n");

  // Check if already have credentials
  const existingCreds = process.env.WHATSAPP_CREDENTIALS;
  if (existingCreds) {
    const existing = loadCredentialsFromEnv(existingCreds);
    if (existing) {
      console.log("⚠️  Existing credentials found in WHATSAPP_CREDENTIALS");
      console.log(
        "   This will create NEW credentials (old ones will be invalidated)\n"
      );
    }
  }

  console.log("Scan the QR code with WhatsApp:\n");
  console.log("  1. Open WhatsApp on your phone");
  console.log("  2. Go to Settings → Linked Devices");
  console.log("  3. Tap 'Link a Device'");
  console.log("  4. Scan the QR code below\n");

  const authState = createAuthState(null);
  const baileysLogger = pino({ level: "silent" });

  let credentialsOutput: string | null = null;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;

    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: {
        creds: authState.state.creds,
        keys: authState.state.keys as any,
      },
      version,
      logger: baileysLogger as any,
      printQRInTerminal: false,
      browser: ["lobu", "setup", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Handle credential updates
    socket.ev.on("creds.update", async () => {
      credentialsOutput = authState.getSerializedState();
    });

    // Wait for connection
    let qrCount = 0;
    const result = await new Promise<"success" | "retry" | "fail">(
      (resolve) => {
        socket.ev.on("connection.update", (update) => {
          const { connection, lastDisconnect, qr } = update;

          if (qr) {
            qrCount++;
            if (qrCount > 1) {
              console.log(`\n🔄 QR code refreshed (attempt ${qrCount})...\n`);
            }
            qrcode.generate(qr, { small: true });
          }

          if (connection === "open") {
            resolve("success");
          }

          if (connection === "close") {
            const statusCode = (lastDisconnect?.error as any)?.output
              ?.statusCode;
            const errorMessage =
              (lastDisconnect?.error as any)?.message || "Unknown error";

            // Retryable errors
            if (
              statusCode === DisconnectReason.restartRequired ||
              statusCode === DisconnectReason.timedOut ||
              statusCode === 515
            ) {
              console.log(
                `\n⚠️  Connection issue (${statusCode}): ${errorMessage}`
              );
              if (attempt < MAX_RETRIES) {
                console.log(
                  `   Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})\n`
                );
              }
              resolve("retry");
            } else if (statusCode === DisconnectReason.loggedOut) {
              console.error(`\n❌ Logged out - session invalidated`);
              resolve("fail");
            } else {
              console.error(
                `\n❌ Connection closed: status=${statusCode}, error=${errorMessage}`
              );
              resolve("fail");
            }
          }
        });
      }
    );

    // Cleanup socket - ignore errors during cleanup
    try {
      socket.ws?.close();
    } catch {
      // Intentionally empty - socket cleanup errors are non-fatal
    }

    if (result === "success") {
      break;
    } else if (result === "fail") {
      throw new Error("WhatsApp setup failed. Please try again.");
    }
    // result === "retry" - loop continues

    // Small delay before retry
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!credentialsOutput) {
    credentialsOutput = authState.getSerializedState();
  }

  // Get final credentials
  const finalCredentials = credentialsOutput;

  // Output
  console.log("\n✅ WhatsApp connected successfully!\n");
  console.log("Add this to your environment:\n");
  console.log("─".repeat(60));
  console.log(`WHATSAPP_CREDENTIALS=${finalCredentials}`);
  console.log("─".repeat(60));
  console.log("\nAlso set:");
  console.log("  WHATSAPP_ENABLED=true");
  console.log("\nOptional:");
  console.log(
    "  WHATSAPP_ALLOW_FROM=+1234567890  # Restrict to specific numbers"
  );
  console.log(
    "  WHATSAPP_REQUIRE_MENTION=true    # Require @mention in groups\n"
  );
}
