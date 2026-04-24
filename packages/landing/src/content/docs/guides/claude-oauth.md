---
title: Claude OAuth (Max plan)
description: Power agents with your Claude Max plan subscription instead of a metered API key.
---

If you have a paid **Claude Max** subscription, you can run agents on it directly — no separate Anthropic API key, no per-token billing. Lobu treats the OAuth access token Claude Code uses as a first-class credential.

This is the recommended path when:

- You already pay for Claude Max and don't want a second metered relationship.
- You want stable rate limits scoped to your Max tier (Pro / Max / Max 20×).
- You're running CI smoke or self-hosted deployments where Anthropic is your primary model.

## Get a token

Run Claude Code locally (`claude`) and complete the OAuth flow once. The token lives at `~/.claude/.credentials.json`. Pull the `accessToken` field out — it starts with `sk-ant-oat01-…` — and treat it as a secret.

You can re-issue tokens anytime by running `claude logout && claude login`.

## Wire it into an agent

Pass the token as `ANTHROPIC_OAUTH_TOKEN` in the gateway environment, then reference it from `lobu.toml`:

```toml
[[agents.<id>.providers]]
id    = "claude"
model = "anthropic/claude-sonnet-4-5"
key   = "$ANTHROPIC_OAUTH_TOKEN"
```

The gateway detects the OAuth-shaped token (`sk-ant-oat…`) and routes through Anthropic's OAuth endpoints with the right beta headers. From the agent's perspective there's no behavioral difference vs. an API key — pi-coding-agent's anthropic provider works the same way.

For a complete working setup, see [`examples/careops/lobu.toml`](https://github.com/lobu-ai/lobu/blob/main/examples/careops/lobu.toml).

## Trade-offs vs. API key

| | OAuth (Max plan) | API key (`sk-ant-api…`) |
|---|---|---|
| Billing | Flat monthly subscription | Per-token, metered |
| Rate limits | Per Max tier (refresh every ~5 min) | Per-key TPM/RPM |
| Token rotation | Manual (`claude logout && claude login`) | Console-managed |
| CI use | Works — set the secret as `ANTHROPIC_OAUTH_TOKEN` | Works — set as `ANTHROPIC_API_KEY` |

If you hit rate limits during long agent runs or batch evals, the API key path scales further. For interactive agent use, OAuth is usually enough.

## Refreshing tokens

OAuth tokens expire after ~8 hours. The gateway's token refresh job (`TokenRefreshJob` in `core-services.ts`) refreshes registered Claude profiles automatically as long as you stored the matching `refreshToken` alongside the access token. Tokens passed through `ANTHROPIC_OAUTH_TOKEN` env var are not auto-refreshed — re-issue and restart when they expire, or use the [admin UI](/guides/admin-ui/) to upsert a profile that includes the refresh token.
