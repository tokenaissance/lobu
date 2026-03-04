import type { ComponentChildren } from "preact";
import { useSettings } from "../app";
import { Section } from "./Section";

function ItemRow({
  badge,
  badgeColor,
  name,
  description,
  locked,
  children,
}: {
  badge: string;
  badgeColor: string;
  name: string;
  description?: string;
  locked?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        {locked && (
          <span class="text-gray-400 text-xs shrink-0" title="System skill">
            &#128274;
          </span>
        )}
        <span
          class={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${badgeColor}`}
        >
          {badge}
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium text-gray-800 truncate">{name}</p>
          {description && (
            <p class="text-xs text-gray-500 truncate">{description}</p>
          )}
        </div>
      </div>
      {children && (
        <div class="flex items-center gap-2 ml-2 flex-shrink-0">{children}</div>
      )}
    </div>
  );
}

function SubItem({
  badge,
  badgeColor,
  name,
  status,
  statusColor,
}: {
  badge: string;
  badgeColor: string;
  name: string;
  status: string;
  statusColor: string;
}) {
  return (
    <div class="flex items-center gap-2 py-0.5">
      <span
        class={`text-[9px] uppercase font-bold px-1 py-0.5 rounded ${badgeColor}`}
      >
        {badge}
      </span>
      <span class="text-[11px] text-gray-600 truncate">{name}</span>
      <span class={`text-[10px] ${statusColor}`}>{status}</span>
    </div>
  );
}

export function SkillsSection() {
  const ctx = useSettings();

  function toggleSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.map((s) =>
      s.repo === repo && !s.system ? { ...s, enabled: !s.enabled } : s
    );
  }

  function removeSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.filter(
      (s) => s.repo !== repo || s.system
    );
  }

  function updateSkillField(repo: string, field: string, value: string) {
    ctx.skills.value = ctx.skills.value.map((s) =>
      s.repo === repo ? { ...s, [field]: value || undefined } : s
    );
  }

  // Collect all available models from all providers for the model preference dropdown (deduplicated by value)
  const allModels = Object.values(ctx.providerModels)
    .flat()
    .filter((m, i, arr) => arr.findIndex((o) => o.value === m.value) === i);

  const count = ctx.skills.value.length;
  const badge =
    count > 0 ? (
      <span class="text-xs text-gray-400">({count})</span>
    ) : undefined;

  return (
    <Section id="skills" title="Skills" icon="&#128218;" badge={badge}>
      <div class="space-y-2">
        {ctx.skillsError.value && (
          <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs">
            {ctx.skillsError.value}
          </div>
        )}

        {count === 0 && (
          <p class="text-xs text-gray-500">
            No skills installed. Ask your agent to find and install skills for
            you.
          </p>
        )}

        {ctx.skills.value.map((skill) => {
          const isSystem = !!skill.system;
          const ownedIntegrations = (skill.integrations || []).map((ig) => {
            const status = ctx.integrationStatus.value[ig.id];
            return { ...ig, connected: !!status?.connected };
          });
          const ownedMcps = skill.mcpServers || [];
          const hasSubItems =
            ownedIntegrations.length > 0 || ownedMcps.length > 0;

          return (
            <div key={`skill-${skill.repo}`} class="space-y-1">
              <ItemRow
                badge={isSystem ? "system" : "skill"}
                badgeColor={
                  isSystem
                    ? "bg-slate-100 text-slate-600"
                    : "bg-purple-100 text-purple-700"
                }
                name={skill.name}
                description={skill.description}
                locked={isSystem}
              >
                {isSystem ? (
                  <span class="px-2 py-1 text-xs rounded bg-slate-100 text-slate-500">
                    Always on
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill.repo)}
                      class={`px-2 py-1 text-xs rounded ${skill.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}
                    >
                      {skill.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSkill(skill.repo)}
                      class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200"
                    >
                      Remove
                    </button>
                  </>
                )}
              </ItemRow>

              {skill.enabled && !isSystem && (
                <div class="ml-6 pl-2 border-l-2 border-purple-100 space-y-1">
                  <div class="flex items-center gap-2 py-0.5">
                    <span class="text-[10px] text-gray-500 w-12 shrink-0">
                      Model
                    </span>
                    <select
                      value={skill.modelPreference || ""}
                      onChange={(e) =>
                        updateSkillField(
                          skill.repo,
                          "modelPreference",
                          (e.target as HTMLSelectElement).value
                        )
                      }
                      class="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white"
                    >
                      <option value="">Agent default</option>
                      {allModels.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="flex items-center gap-2 py-0.5">
                    <span class="text-[10px] text-gray-500 w-12 shrink-0">
                      Thinking
                    </span>
                    <select
                      value={skill.thinkingLevel || ""}
                      onChange={(e) =>
                        updateSkillField(
                          skill.repo,
                          "thinkingLevel",
                          (e.target as HTMLSelectElement).value
                        )
                      }
                      class="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white"
                    >
                      <option value="">Default</option>
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  {ownedIntegrations.map((ig) => (
                    <SubItem
                      key={`skill-ig-${ig.id}`}
                      badge={ig.authType || "oauth"}
                      badgeColor="bg-amber-50 text-amber-600"
                      name={ig.label || ig.id}
                      status={ig.connected ? "connected" : "not connected"}
                      statusColor={
                        ig.connected ? "text-green-600" : "text-gray-400"
                      }
                    />
                  ))}
                  {ownedMcps.map((m) => (
                    <SubItem
                      key={`skill-mcp-${m.id}`}
                      badge="mcp"
                      badgeColor="bg-blue-50 text-blue-600"
                      name={m.name || m.id}
                      status="included"
                      statusColor="text-gray-500"
                    />
                  ))}
                </div>
              )}
              {hasSubItems && skill.enabled && isSystem && (
                <div class="ml-6 pl-2 border-l-2 border-purple-100 space-y-1">
                  {ownedIntegrations.map((ig) => (
                    <SubItem
                      key={`skill-ig-${ig.id}`}
                      badge={ig.authType || "oauth"}
                      badgeColor="bg-amber-50 text-amber-600"
                      name={ig.label || ig.id}
                      status={ig.connected ? "connected" : "not connected"}
                      statusColor={
                        ig.connected ? "text-green-600" : "text-gray-400"
                      }
                    />
                  ))}
                  {ownedMcps.map((m) => (
                    <SubItem
                      key={`skill-mcp-${m.id}`}
                      badge="mcp"
                      badgeColor="bg-blue-50 text-blue-600"
                      name={m.name || m.id}
                      status="included"
                      statusColor="text-gray-500"
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
