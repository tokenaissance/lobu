/**
 * POST /api/install/token
 * Mints a short-lived install token for a signed-in user. The landing page
 * embeds it in a `https://wa.me/<bot-phone>?text=install:<token>` link so the
 * user can claim the install via WhatsApp without re-typing their phone
 * number.
 */

import { type Context, Hono } from 'hono';
import { requireAuth } from '../auth/middleware';
import type { Env } from '../index';
import { errorMessage } from '../utils/errors';
import { mintInstallToken } from './install-token';

const installTokenRoutes = new Hono<{ Bindings: Env }>();

function getAuthenticatedUser(c: Context<{ Bindings: Env }>) {
  const user = c.get('user');
  if (!user) throw new Error('Authenticated user missing from context');
  return user;
}

installTokenRoutes.post('/install/token', requireAuth, async (c) => {
  const user = getAuthenticatedUser(c);

  let body: { templateAgentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.templateAgentId || typeof body.templateAgentId !== 'string') {
    return c.json({ error: 'templateAgentId is required' }, 400);
  }

  try {
    const token = mintInstallToken({
      userId: user.id,
      templateAgentId: body.templateAgentId,
    });
    return c.json({
      token,
      expiresInSeconds: 15 * 60,
      // wa.me link is constructed by the caller — they know the bot's phone
      // number from the connection config (or hard-coded in the landing
      // page). We don't ship phone numbers from this endpoint.
    });
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 500);
  }
});

export { installTokenRoutes };
