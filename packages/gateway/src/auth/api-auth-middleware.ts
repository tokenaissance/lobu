import { timingSafeEqual } from "node:crypto";
import { verifyWorkerToken } from "@lobu/core";
import type { Context, Next } from "hono";
import { verifySettingsSession } from "../routes/public/settings-auth";
import type { CliTokenService } from "./cli/token-service";

export const TOKEN_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a Hono middleware that enforces the standard auth check:
 *   1. Settings session cookie  2. CLI JWT  3. Admin password  4. Worker token
 */
export function createApiAuthMiddleware(opts: {
  adminPassword?: string;
  cliTokenService?: CliTokenService;
  allowWorkerToken?: boolean;
  allowSettingsSession?: boolean;
}) {
  return async (c: Context, next: Next) => {
    // 1. Try settings session cookie when explicitly allowed.
    if (opts.allowSettingsSession && verifySettingsSession(c)) return next();

    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    const token = authHeader.substring(7);

    // 2. Try CLI JWT
    if (opts.cliTokenService) {
      const identity = await opts.cliTokenService.verifyAccessToken(token);
      if (identity) return next();
    }

    // 3. Try admin password
    if (opts.adminPassword) {
      const a = Buffer.from(token);
      const b = Buffer.from(opts.adminPassword);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return next();
      }
    }

    // 4. Try worker token when explicitly allowed for the route
    if (opts.allowWorkerToken !== false) {
      const workerData = verifyWorkerToken(token);
      if (workerData) {
        const tokenAge = Date.now() - workerData.timestamp;
        if (tokenAge <= TOKEN_EXPIRATION_MS) {
          return next();
        }
      }
    }

    return c.json({ success: false, error: "Unauthorized" }, 401);
  };
}
