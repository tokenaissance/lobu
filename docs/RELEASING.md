# Releasing

This repo publishes four packages to npm — `@lobu/core`, `@lobu/gateway`,
`@lobu/worker`, and `@lobu/cli` — as a single synchronized release. All four
are pinned to the same version via `scripts/bump-version.mjs` and published
from CI using npm trusted publishing (OIDC), so there are no long-lived
`NPM_TOKEN` secrets or manual OTP steps.

## TL;DR

```bash
# 1. Make a release branch and bump the version
git checkout -b release/<new-version>
node scripts/bump-version.mjs patch        # or minor | major | <explicit>
git commit -am "chore(release): bump all packages to <new-version>"
git push -u origin release/<new-version>

# 2. Open a PR, wait for CI green, merge
gh pr create --title "chore(release): <new-version>" --body "Release <new-version>" --base main
gh pr merge --squash --delete-branch

# 3. Trigger the publish workflow
gh workflow run publish-packages.yml -f bump=skip
```

That's the whole flow. One branch, one PR, one workflow run.

## Picking a bump type

| Bump | When |
| --- | --- |
| `patch` | Bug fixes, refactors, docs, tests, CI tweaks. No behavior change for consumers. |
| `minor` | Additive features: new exports, new CLI commands, new MCP tools, new agent settings fields, new platform connections. Existing consumers keep working without changes. |
| `major` | Breaking changes: removed exports, changed worker protocol, `lobu.toml` schema changes that invalidate existing configs, etc. |
| `<explicit>` | Skip-bumps, hotfix branches, or anything else that needs a specific version. Pass the full `X.Y.Z` string. |

## Step 1 — Bump locally

Always bump locally, not in CI. The `publish-packages.yml` workflow can bump
(via its `bump` input), but the bump would happen only on the runner
filesystem and never make it back to `main`, leaving `package.json` stale.
So we bump locally, commit the bump to a release branch, and trigger publish
with `-f bump=skip`.

```bash
node scripts/bump-version.mjs patch
```

This updates `package.json` and each of `packages/{core,gateway,worker,cli}/package.json`
to the new version in lockstep. It does **not** touch `charts/` — if you
need to bump the chart version too, do it in the same commit.

## Step 2 — PR and merge

Branch protection requires a PR into `main`. Create one on a
`release/<version>` branch:

```bash
git checkout -b release/3.1.0
node scripts/bump-version.mjs minor
git commit -am "chore(release): bump all packages to 3.1.0"
git push -u origin release/3.1.0
gh pr create --title "chore(release): 3.1.0" --body "Release 3.1.0" --base main
```

Wait for the CI job on the PR to pass, then merge:

```bash
gh pr merge --squash --delete-branch
```

Squash merge keeps `main` linear — one commit per release, matching the
convention from the existing history.

## Step 3 — Publish

Trigger the publish workflow against the updated `main`:

```bash
gh workflow run publish-packages.yml -f bump=skip
```

`bump=skip` tells `scripts/publish-packages.mjs` to use the version that's
already in `package.json` (the one you just bumped in Step 1) rather than
bumping again.

The workflow:

1. Checks out `main` at the merge commit.
2. Runs `bun install --frozen-lockfile`.
3. Runs `node scripts/publish-packages.mjs --skip-bump`, which:
   - Builds `core`, `gateway`, `worker`, `cli`.
   - For each package, rewrites `workspace:*` deps to the concrete version
     in a temporary `package.json` mutation, runs `npm publish --access public`,
     and restores the original file.
   - Skips any package whose current version is already on npm (so partial
     failures are retryable without a second bump).
4. npm's OIDC trusted publisher exchange runs automatically because the
   workflow has `id-token: write` and each package is registered as a
   trusted publisher on npmjs.com with:
   - Organization: `lobu-ai`
   - Repository: `lobu`
   - Workflow: `publish-packages.yml`
   - Environment: `production`
5. npm attaches a provenance attestation tied to the workflow run.

A successful run takes ~40–60s. Watch it live:

```bash
gh run watch
```

Or view afterwards:

```bash
gh run list --workflow=publish-packages.yml --limit 5
gh run view <run-id>
```

## Step 4 — Verify

```bash
npm view @lobu/core version
npm view @lobu/gateway version
npm view @lobu/worker version
npm view @lobu/cli version
```

All four should match the new version. If any lag, re-trigger the workflow
— it's idempotent.

## Recovery playbook

**Publish step fails on the first package** — Fix the underlying issue, push
a follow-up commit to `main`, re-run `gh workflow run publish-packages.yml
-f bump=skip`. Since nothing was published yet, no cleanup is needed.

**Publish step fails after some packages already landed on npm** — Fix the
issue, push a follow-up to `main`, re-run. The script's
`isVersionPublished` check skips the packages that already landed. The
remaining ones will publish. No version bump needed.

**Wrong version or broken build made it to npm** — npm allows
`npm unpublish` only within 72 hours of first publish and only if you are
the sole owner. In most cases you should instead:

```bash
npm deprecate '@lobu/core@<bad-version>' "broken build, use <good-version>"
# repeat for the other three packages
```

Then bump and publish a fixed version normally.

**`workspace:*` rewrite throws** — `publish-packages.mjs` throws when it
finds a `workspace:*` dep outside the `@lobu/*` scope. That means a new
workspace was added without updating the script. Open
`scripts/publish-packages.mjs`, either add the new package to the
`PACKAGES` array (if it should be published) or allow the ref (if it
shouldn't).

## If you need to publish from your laptop

Don't. CI via trusted publishing is the default path — it's faster, has
provenance attestations, and doesn't need you to `npm login` or type an
OTP.

If CI is down and you absolutely need to ship, the local script still
works. You must be logged into npm as a maintainer of the `@lobu` scope.

```bash
npm whoami                    # verify
npm login --auth-type=web     # if not logged in

# Then either:
node scripts/publish-packages.mjs patch              # auto-bump + build + publish
node scripts/publish-packages.mjs 3.1.0              # explicit version
node scripts/publish-packages.mjs --skip-bump        # publish current package.json version
node scripts/publish-packages.mjs --otp=123456 patch # pre-supply OTP (avoids prompt)
```

You can also set the OTP via env: `NPM_OTP=123456 node scripts/publish-packages.mjs patch`.

## What's NOT automated

- **Changelog generation.** We removed release-please. If we reinstall it
  later, this doc gets updated.
- **GitHub release notes.** After a publish, optionally run
  `gh release create v<new-version> --generate-notes` to create a GitHub
  release from the merge commit.
- **Docker image + chart publish.** Handled by other workflows
  (`docker-publish.yml` etc.) triggered by separate events.
- **Version bumping of `charts/lobu/Chart.yaml`.** If you bump an npm
  package version and also want the Helm chart to match, edit
  `charts/lobu/Chart.yaml` in the same release commit.

## Not used anymore

The following files existed in earlier iterations and have been removed.
If you see references in old docs, git history, or commit messages, know
that they are **gone**:

- `.github/workflows/release-please.yml` — abandoned release-please flow
  with a manifest stuck at `3.0.7`. Deleted.
- `.github/workflows/release.yml` — copy-pasted template from
  `anthropics/claude-code-action`; created `v*` tags and tried to sync
  releases to an unrelated repo. Deleted.
- `release-please-config.json`, `.release-please-manifest.json` — config
  for the above. Deleted.
- `scripts/stage-publish-package.mjs` — replaced by
  `scripts/publish-packages.mjs`.
