import { useSignal } from "@preact/signals";
import { Marked } from "marked";
import { useEffect, useMemo } from "preact/hooks";
import * as api from "../api";
import { useSettings } from "../app";
import { triggerProviderAuth } from "./ProviderSection";

const marked = new Marked({ async: false });

/** Resolved skill details fetched from the registry */
interface ResolvedSkillDetail {
  repo: string;
  name: string;
  description: string;
  content?: string;
  integrations?: Array<{
    id: string;
    label?: string;
    authType?: "oauth" | "api-key";
  }>;
  mcpServers?: Array<{ id: string; name?: string; url?: string }>;
  nixPackages?: string[];
  permissions?: string[];
}

export function MessageBanners() {
  const ctx = useSettings();

  return (
    <>
      {ctx.successMsg.value && (
        <div class="bg-green-100 text-green-800 px-3 py-2 rounded-lg mb-4 text-center text-sm">
          {ctx.successMsg.value}
        </div>
      )}
      {ctx.errorMsg.value && (
        <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg mb-4 text-center text-sm">
          {ctx.errorMsg.value}
        </div>
      )}
      {ctx.message && (
        <div class="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-4 text-sm">
          <div class="flex items-start gap-2">
            <span class="text-lg">&#128161;</span>
            <div>{ctx.message}</div>
          </div>
        </div>
      )}
      <PendingApiKeysBanner />
      <PrefillBanner />
    </>
  );
}

function PendingApiKeysBanner() {
  const ctx = useSettings();

  // Derive pending API-key integrations from skills + integrationStatus
  const pending: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const skill of ctx.skills.value) {
    if (!skill.enabled || !skill.integrations) continue;
    for (const ig of skill.integrations) {
      if (ig.authType !== "api-key" || seen.has(ig.id)) continue;
      seen.add(ig.id);
      const status = ctx.integrationStatus.value[ig.id];
      if (!status?.connected) {
        pending.push({ id: ig.id, label: ig.label || ig.id });
      }
    }
  }

  if (pending.length === 0) return null;

  return (
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#128273;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">API key required</h3>
          <p class="text-xs text-amber-700 mt-0.5">
            Enter your API key to activate{" "}
            {pending.length === 1 ? "this integration" : "these integrations"}.
          </p>
        </div>
      </div>
      <div class="space-y-2">
        {pending.map((integration) => (
          <PendingApiKeyRow key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  );
}

function PendingApiKeyRow({
  integration,
}: {
  integration: { id: string; label: string };
}) {
  const ctx = useSettings();
  const keyValue = useSignal("");
  const saving = useSignal(false);
  const error = useSignal("");

  async function handleSave() {
    const key = keyValue.value.trim();
    if (!key) return;
    saving.value = true;
    error.value = "";
    try {
      await api.saveIntegrationApiKey(ctx.agentId, integration.id, key);
      ctx.integrationStatus.value = {
        ...ctx.integrationStatus.value,
        [integration.id]: {
          connected: true,
          accounts: [{ accountId: "default", grantedScopes: [] }],
          availableScopes:
            ctx.integrationStatus.value[integration.id]?.availableScopes || [],
        },
      };
      keyValue.value = "";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to save";
    } finally {
      saving.value = false;
    }
  }

  return (
    <div class="space-y-1">
      <p class="text-xs font-medium text-amber-900">{integration.label}</p>
      <div class="flex items-center gap-1.5">
        <input
          type="password"
          value={keyValue.value}
          onInput={(e) => {
            keyValue.value = (e.target as HTMLInputElement).value;
          }}
          placeholder="Paste API key..."
          class="flex-1 px-2 py-1.5 border border-amber-200 rounded text-xs bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-200 outline-none"
        />
        <button
          type="button"
          disabled={saving.value || !keyValue.value.trim()}
          onClick={handleSave}
          class="px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {saving.value ? "Saving..." : "Save"}
        </button>
      </div>
      {error.value && <p class="text-xs text-red-600">{error.value}</p>}
    </div>
  );
}

function PrefillBanner() {
  const ctx = useSettings();
  const resolvedSkills = useSignal<ResolvedSkillDetail[]>([]);
  const skillsLoading = useSignal(false);
  const oauthCredentials = useSignal<
    Record<string, { clientId: string; clientSecret: string }>
  >({});

  const hasPrefills =
    ctx.prefillGrants.value.length > 0 ||
    ctx.prefillNixPackages.value.length > 0 ||
    ctx.prefillProviders.value.length > 0 ||
    ctx.prefillSkills.value.length > 0 ||
    ctx.prefillMcpServers.value.length > 0;

  // Eagerly fetch skill details when banner mounts
  useEffect(() => {
    if (
      ctx.prefillSkills.value.length === 0 ||
      ctx.prefillBannerDismissed.value
    )
      return;

    skillsLoading.value = true;
    Promise.all(
      ctx.prefillSkills.value.map(async (s) => {
        try {
          const fetched = await api.fetchSkillContent(s.repo);
          return {
            repo: s.repo,
            name: fetched.name || s.name || s.repo,
            description: fetched.description || s.description || "",
            content: fetched.content,
            integrations: fetched.integrations,
            mcpServers: fetched.mcpServers,
            nixPackages: fetched.nixPackages,
            permissions: fetched.permissions,
          } satisfies ResolvedSkillDetail;
        } catch {
          return {
            repo: s.repo,
            name: s.name || s.repo,
            description: s.description || "",
          } satisfies ResolvedSkillDetail;
        }
      })
    ).then((results) => {
      resolvedSkills.value = results;
      skillsLoading.value = false;
    });
  }, []);

  if (!hasPrefills || ctx.prefillBannerDismissed.value) return null;

  async function handleApproveAll() {
    ctx.approvingPrefills.value = true;
    ctx.errorMsg.value = "";
    ctx.successMsg.value = "";
    try {
      // 0. Validate and save OAuth credentials first
      const allSkillIntegrations = resolvedSkills.value.flatMap((s) =>
        (s.integrations || []).filter((ig) => ig.authType !== "api-key")
      );
      const requiredOAuth = allSkillIntegrations.filter((ig) => {
        const status = ctx.integrationStatus.value[ig.id];
        return !status?.connected;
      });
      for (const ig of requiredOAuth) {
        const cred = oauthCredentials.value[ig.id];
        if (!cred?.clientId?.trim() || !cred?.clientSecret?.trim()) {
          ctx.errorMsg.value = `Please enter Client ID and Client Secret for ${ig.label || ig.id}`;
          ctx.approvingPrefills.value = false;
          return;
        }
      }

      for (const [integrationId, cred] of Object.entries(
        oauthCredentials.value
      )) {
        const id = cred.clientId.trim();
        const secret = cred.clientSecret.trim();
        if (!id || !secret) continue;
        await api.saveOAuthAppCredentials(
          ctx.agentId,
          integrationId,
          id,
          secret
        );
        ctx.integrationStatus.value = {
          ...ctx.integrationStatus.value,
          [integrationId]: {
            ...ctx.integrationStatus.value[integrationId],
            configured: true,
          },
        };
      }

      // 1. Add grants to local state
      for (const d of ctx.prefillGrants.value) {
        if (!ctx.permissionGrants.value.some((g) => g.pattern === d)) {
          ctx.permissionGrants.value = [
            ...ctx.permissionGrants.value,
            { pattern: d, expiresAt: null },
          ];
        }
      }

      // 2. Merge nix packages locally
      if (ctx.prefillNixPackages.value.length > 0) {
        const merged = [...ctx.nixPackages.value];
        for (const pkg of ctx.prefillNixPackages.value) {
          const name = (pkg || "").trim();
          if (name && !merged.includes(name)) merged.push(name);
        }
        ctx.nixPackages.value = merged;
      }

      // 3. Add prefill skills locally (reuse already-fetched data when available)
      const failures: string[] = [];
      for (const skill of ctx.prefillSkills.value) {
        if (ctx.skills.value.some((s) => s.repo === skill.repo)) continue;
        try {
          const fetched = await api.fetchSkillContent(skill.repo);
          ctx.skills.value = [
            ...ctx.skills.value,
            {
              repo: fetched.repo,
              name: fetched.name || skill.name || "",
              description: fetched.description || skill.description || "",
              enabled: true,
              content: fetched.content,
              contentFetchedAt: fetched.fetchedAt,
              integrations: fetched.integrations,
              mcpServers: fetched.mcpServers,
              nixPackages: fetched.nixPackages,
              permissions: fetched.permissions,
            },
          ];
        } catch {
          failures.push(skill.name || skill.repo);
        }
      }

      // 4. Add prefill MCPs locally
      for (const mcp of ctx.prefillMcpServers.value) {
        if (ctx.mcpServers.value[mcp.id]) continue;
        const mcpConfig: Record<string, unknown> = {};
        if (mcp.url) mcpConfig.url = mcp.url;
        if (mcp.type) mcpConfig.type = mcp.type;
        if (mcp.command) mcpConfig.command = mcp.command;
        if (mcp.args) mcpConfig.args = mcp.args;
        if (mcp.name) mcpConfig.description = mcp.name;
        ctx.mcpServers.value = { ...ctx.mcpServers.value, [mcp.id]: mcpConfig };
      }

      // 5. Auto-trigger provider auth flows for prefilled providers
      if (ctx.prefillProviders.value.length > 0) {
        ctx.openSections.value = { ...ctx.openSections.value, model: true };
        for (const pid of ctx.prefillProviders.value) {
          triggerProviderAuth(ctx, pid);
        }
      }

      // 6. Record approved skill names for post-save callback
      ctx.approvedPrefillSkills.value = ctx.prefillSkills.value.map(
        (s) => s.name || s.repo
      );

      // 7. Dismiss + show result
      ctx.prefillBannerDismissed.value = true;
      ctx.errorMsg.value = "";
      if (failures.length > 0) {
        ctx.errorMsg.value = `Some items failed to add: ${failures.join(", ")}`;
      }

      // Scroll to provider section if providers were requested, otherwise scroll to top
      if (ctx.prefillProviders.value.length > 0) {
        const providerList = document.getElementById("provider-list");
        if (providerList) {
          providerList.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else {
        ctx.successMsg.value =
          "Changes accepted! Click Save Settings to apply.";
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e: unknown) {
      ctx.errorMsg.value =
        "Error approving changes: " +
        (e instanceof Error ? e.message : "Unknown error");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      ctx.approvingPrefills.value = false;
    }
  }

  function handleDismiss() {
    ctx.prefillBannerDismissed.value = true;
    const u = new URL(window.location.href);
    u.searchParams.set("dismissed", "1");
    window.history.replaceState({}, "", u.toString());
  }

  return (
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-2 mb-3">
        <span class="text-lg">&#9888;&#65039;</span>
        <div>
          <h3 class="text-sm font-semibold text-amber-900">
            Pending changes from your agent
          </h3>
          <p class="text-xs text-amber-700 mt-0.5">
            Review and approve the requested configuration changes.
          </p>
        </div>
      </div>
      <div class="space-y-2 mb-3">
        {ctx.prefillSkills.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#9889; Skills
            </p>
            <div class="space-y-2">
              {skillsLoading.value ? (
                <p class="text-xs text-amber-600">Loading skill details...</p>
              ) : resolvedSkills.value.length > 0 ? (
                resolvedSkills.value.map((skill) => (
                  <PrefillSkillCard
                    key={skill.repo}
                    skill={skill}
                    prefillMcpServers={ctx.prefillMcpServers.value}
                    prefillGrants={ctx.prefillGrants.value}
                    prefillNixPackages={ctx.prefillNixPackages.value}
                    oauthCredentials={oauthCredentials}
                  />
                ))
              ) : (
                ctx.prefillSkills.value.map((s) => (
                  <div key={s.repo} class="flex items-center gap-2">
                    <span class="text-xs font-medium text-amber-900">
                      {s.name || s.repo}
                    </span>
                    <span class="text-xs text-amber-600 font-mono">
                      {s.repo}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {ctx.prefillProviders.value.length > 0 && (
          <div>
            <p class="text-xs font-medium text-amber-800 mb-1">
              &#128273; Providers
            </p>
            <div class="flex flex-wrap gap-1">
              {ctx.prefillProviders.value.map((pid) => {
                const pInfo = ctx.PROVIDERS[pid];
                return (
                  <span
                    key={pid}
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-medium text-amber-900"
                  >
                    {ctx.providerIconUrls[pid] && (
                      <img
                        src={ctx.providerIconUrls[pid]}
                        alt=""
                        class="w-3 h-3"
                      />
                    )}
                    {pInfo?.name || pid}
                  </span>
                );
              })}
            </div>
            <p class="text-xs text-amber-700 mt-1">
              Click Approve to open the provider setup.
            </p>
          </div>
        )}
        {/* Show standalone sections only when there are no skills to group them under */}
        {ctx.prefillSkills.value.length === 0 &&
          ctx.prefillGrants.value.length > 0 && (
            <div>
              <p class="text-xs font-medium text-amber-800 mb-1">
                &#127760; Network Access Domains
              </p>
              <div class="flex flex-wrap gap-1">
                {ctx.prefillGrants.value.map((d) => (
                  <span
                    key={d}
                    class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        {ctx.prefillSkills.value.length === 0 &&
          ctx.prefillNixPackages.value.length > 0 && (
            <div>
              <p class="text-xs font-medium text-amber-800 mb-1">
                &#128230; System Packages
              </p>
              <div class="flex flex-wrap gap-1">
                {ctx.prefillNixPackages.value.map((p) => (
                  <span
                    key={p}
                    class="inline-block px-1.5 py-0.5 bg-white border border-amber-200 rounded text-xs font-mono text-amber-900"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        {ctx.prefillSkills.value.length === 0 &&
          ctx.prefillMcpServers.value.length > 0 && (
            <div>
              <p class="text-xs font-medium text-amber-800 mb-1">
                &#128268; MCP Servers
              </p>
              <div class="space-y-1">
                {ctx.prefillMcpServers.value.map((m) => (
                  <div key={m.id} class="flex items-center gap-2">
                    <span class="text-xs font-medium text-amber-900">
                      {m.name || m.id}
                    </span>
                    <span class="text-xs text-amber-600 font-mono">
                      {m.url || ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          onClick={handleApproveAll}
          disabled={ctx.approvingPrefills.value}
          class="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all disabled:opacity-60"
        >
          {ctx.approvingPrefills.value ? "Approving..." : "Approve All"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          class="px-4 py-2 text-xs font-medium rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition-all"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Expanded card showing skill details.
 *
 * Merges two data sources:
 * 1. Skill's own SKILL.md frontmatter (integrations, mcpServers from registry)
 * 2. Prefill context data (MCP servers, grants, packages extracted by the worker)
 *
 * This ensures the card shows the full picture even when the SKILL.md frontmatter
 * is sparse — the worker already resolved the manifest and sent the details as
 * separate prefill fields.
 */
function PrefillSkillCard({
  skill,
  prefillMcpServers,
  prefillGrants,
  prefillNixPackages,
  oauthCredentials,
}: {
  skill: ResolvedSkillDetail;
  prefillMcpServers: Array<{ id: string; name?: string; url?: string }>;
  prefillGrants: string[];
  prefillNixPackages: string[];
  oauthCredentials: ReturnType<
    typeof useSignal<Record<string, { clientId: string; clientSecret: string }>>
  >;
}) {
  const ctx = useSettings();

  // Merge skill's own sub-items with prefill context data (deduped)
  const skillMcpIds = new Set(skill.mcpServers?.map((m) => m.id) || []);
  const extraMcps = prefillMcpServers.filter((m) => !skillMcpIds.has(m.id));
  const allMcps = [...(skill.mcpServers || []), ...extraMcps];

  const skillPermissions = new Set(skill.permissions || []);
  const extraGrants = prefillGrants.filter((g) => !skillPermissions.has(g));
  const allPermissions = [...(skill.permissions || []), ...extraGrants];

  const skillPkgs = new Set(skill.nixPackages || []);
  const extraPkgs = prefillNixPackages.filter((p) => !skillPkgs.has(p));
  const allNixPackages = [...(skill.nixPackages || []), ...extraPkgs];

  // Identify unconfigured OAuth integrations for this skill
  // Show credential form for OAuth integrations that are not yet connected
  const unconfiguredOAuth = (skill.integrations || []).filter((ig) => {
    if (ig.authType === "api-key") return false;
    const status = ctx.integrationStatus.value[ig.id];
    return !status?.connected;
  });

  const hasDetails =
    (skill.integrations && skill.integrations.length > 0) ||
    allMcps.length > 0 ||
    allPermissions.length > 0 ||
    allNixPackages.length > 0;

  // Strip YAML frontmatter from content for display
  const bodyContent = skill.content
    ? skill.content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
    : "";

  return (
    <div class="bg-white border border-amber-200 rounded-lg p-2.5">
      <div class="space-y-0.5">
        <div class="flex items-center gap-1.5">
          <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">
            skill
          </span>
          <span class="text-xs font-medium text-gray-800">{skill.name}</span>
        </div>
        <p class="text-[10px] text-amber-500 font-mono ml-1">{skill.repo}</p>
        {skill.description && (
          <p class="text-xs text-gray-500 truncate ml-1">{skill.description}</p>
        )}
      </div>

      {hasDetails && (
        <div class="mt-2 ml-4 pl-2 border-l-2 border-purple-100 space-y-1">
          {[
            ...(skill.integrations || []).map((ig) => ({
              key: ig.id,
              badge: ig.authType || "oauth",
              name: ig.label || ig.id,
              detail: null as string | null,
            })),
            ...allMcps.map((m) => ({
              key: m.id,
              badge: "mcp",
              name: m.name || m.id,
              detail: m.url || null,
            })),
          ].map((item) => (
            <div key={item.key} class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-600">
                {item.badge}
              </span>
              <span class="text-[11px] text-gray-600 truncate">
                {item.name}
              </span>
              {item.detail && (
                <span class="text-[10px] text-gray-400 font-mono truncate">
                  {item.detail}
                </span>
              )}
            </div>
          ))}
          {allPermissions.length > 0 && (
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-red-50 text-red-600">
                network
              </span>
              <span class="text-[11px] text-gray-600">
                {allPermissions.join(", ")}
              </span>
            </div>
          )}
          {allNixPackages.length > 0 && (
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-green-50 text-green-600">
                packages
              </span>
              <span class="text-[11px] text-gray-600">
                {allNixPackages.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      {unconfiguredOAuth.length > 0 && (
        <div class="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
          <p class="text-[11px] font-medium text-amber-800">
            &#128273; OAuth credentials required
          </p>
          {unconfiguredOAuth.map((ig) => {
            const cred = oauthCredentials.value[ig.id] || {
              clientId: "",
              clientSecret: "",
            };
            return (
              <div key={ig.id} class="space-y-1">
                <p class="text-[11px] font-medium text-amber-900">
                  {ig.label || ig.id}
                </p>
                <div class="space-y-1.5">
                  <label class="block">
                    <span class="block text-[10px] text-amber-700 mb-0.5">
                      Client ID
                    </span>
                    <input
                      type="text"
                      value={cred.clientId}
                      onInput={(e) => {
                        oauthCredentials.value = {
                          ...oauthCredentials.value,
                          [ig.id]: {
                            ...cred,
                            clientId: (e.target as HTMLInputElement).value,
                          },
                        };
                      }}
                      placeholder="Client ID"
                      class="w-full px-2 py-1.5 border border-amber-200 rounded text-xs bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-200 outline-none"
                    />
                  </label>
                  <label class="block">
                    <span class="block text-[10px] text-amber-700 mb-0.5">
                      Client Secret
                    </span>
                    <input
                      type="password"
                      value={cred.clientSecret}
                      onInput={(e) => {
                        oauthCredentials.value = {
                          ...oauthCredentials.value,
                          [ig.id]: {
                            ...cred,
                            clientSecret: (e.target as HTMLInputElement).value,
                          },
                        };
                      }}
                      placeholder="Client Secret"
                      class="w-full px-2 py-1.5 border border-amber-200 rounded text-xs bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-200 outline-none"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {bodyContent && <SkillContentToggle content={bodyContent} />}
    </div>
  );
}

/** Collapsible rendered markdown preview of the skill's SKILL.md body */
function SkillContentToggle({ content }: { content: string }) {
  const expanded = useSignal(false);
  const html = useMemo(() => marked.parse(content) as string, [content]);

  return (
    <div class="mt-2">
      <button
        type="button"
        onClick={() => {
          expanded.value = !expanded.value;
        }}
        class="text-[11px] text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
      >
        <span class="text-[10px]">{expanded.value ? "\u25BC" : "\u25B6"}</span>
        {expanded.value ? "Hide skill content" : "View skill content"}
      </button>
      {expanded.value && (
        <div
          class="skill-content mt-1.5 p-2.5 bg-gray-50 border border-gray-200 rounded max-h-72 overflow-y-auto text-[11px] text-gray-700 leading-relaxed"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized markdown from skill manifest
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
