import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { type RegistryEntry, useSettings } from "../app";
import { Section } from "./Section";

function ItemRow({
  name,
  description,
  system,
  children,
}: {
  name: string;
  description?: string;
  system?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span
          class={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${system ? "bg-slate-100 text-slate-600" : "bg-purple-100 text-purple-700"}`}
        >
          {system ? "lobu" : "skill"}
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

export function SkillsSection({ adminOnly }: { adminOnly?: boolean }) {
  const ctx = useSettings();

  function toggleSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.map((s) =>
      s.repo === repo ? { ...s, enabled: !s.enabled } : s
    );
  }

  function removeSkill(repo: string) {
    ctx.skills.value = ctx.skills.value.filter((s) => s.repo !== repo);
  }

  function updateSkillField(repo: string, field: string, value: string) {
    ctx.skills.value = ctx.skills.value.map((s) =>
      s.repo === repo ? { ...s, [field]: value || undefined } : s
    );
  }

  // Build flat model options from all providers
  const allModelOptions = Object.entries(ctx.providerModels)
    .flatMap(([, models]) => models)
    .filter((m, i, arr) => arr.findIndex((o) => o.value === m.value) === i);

  const openModelDropdown = useSignal<string | null>(null);

  const count = ctx.skills.value.length;
  const badge =
    count > 0 ? (
      <span class="text-xs text-gray-400">({count})</span>
    ) : undefined;

  return (
    <Section
      id="skills"
      title="Skills"
      icon="&#128218;"
      badge={badge}
      adminOnly={adminOnly}
    >
      <div class="space-y-2">
        {ctx.skillsError.value && (
          <div class="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-xs">
            {ctx.skillsError.value}
          </div>
        )}

        {ctx.memoryEnabled && (
          <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 bg-amber-100 text-amber-700">
                memory
              </span>
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-800 truncate">
                  Owletto Memory
                </p>
                <p class="text-xs text-gray-500 truncate">
                  Long-term memory across conversations
                </p>
              </div>
            </div>
            <span class="px-2 py-1 text-xs rounded bg-green-100 text-green-800">
              Active
            </span>
          </div>
        )}

        {count === 0 && !ctx.memoryEnabled && (
          <p class="text-xs text-gray-500">
            No skills installed. Ask your agent to find and install skills for
            you.
          </p>
        )}

        {ctx.skills.value.map((skill) => {
          const ownedIntegrations = (skill.integrations || []).map((ig) => {
            const status = ctx.integrationStatus.value[ig.id];
            return { ...ig, connected: !!status?.connected };
          });
          const ownedMcps = skill.mcpServers || [];
          const hasSubItems =
            ownedIntegrations.length > 0 || ownedMcps.length > 0;
          const fieldIdBase = skill.repo.replace(/[^a-zA-Z0-9_-]/g, "-");
          const modelInputId = `${fieldIdBase}-model`;
          const thinkingSelectId = `${fieldIdBase}-thinking`;

          return (
            <div key={`skill-${skill.repo}`} class="space-y-1">
              <ItemRow
                name={skill.name}
                description={skill.description}
                system={skill.system}
              >
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
              </ItemRow>

              {skill.enabled && (
                <div class="ml-6 pl-2 border-l-2 border-gray-100 space-y-1.5 py-1">
                  <div class="flex items-center gap-2">
                    <label
                      htmlFor={modelInputId}
                      class="text-[10px] text-gray-500 w-12 shrink-0"
                    >
                      Model
                    </label>
                    <div class="relative flex-1 min-w-0">
                      <input
                        id={modelInputId}
                        type="text"
                        value={skill.modelPreference || ""}
                        onInput={(e) => {
                          const val = (e.target as HTMLInputElement).value;
                          updateSkillField(skill.repo, "modelPreference", val);
                          openModelDropdown.value = skill.repo;
                        }}
                        onFocus={() => {
                          openModelDropdown.value = skill.repo;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape")
                            openModelDropdown.value = null;
                        }}
                        placeholder="default"
                        class="w-full text-[11px] px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-700"
                      />
                      {openModelDropdown.value === skill.repo && (
                        <div class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => {
                              updateSkillField(
                                skill.repo,
                                "modelPreference",
                                ""
                              );
                              openModelDropdown.value = null;
                            }}
                            class="w-full text-left px-2 py-1 text-[11px] hover:bg-gray-100 text-gray-500"
                          >
                            Default
                          </button>
                          {allModelOptions
                            .filter(
                              (m) =>
                                !skill.modelPreference ||
                                m.label
                                  .toLowerCase()
                                  .includes(
                                    (skill.modelPreference || "").toLowerCase()
                                  ) ||
                                m.value
                                  .toLowerCase()
                                  .includes(
                                    (skill.modelPreference || "").toLowerCase()
                                  )
                            )
                            .map((m) => (
                              <button
                                key={m.value}
                                type="button"
                                onClick={() => {
                                  updateSkillField(
                                    skill.repo,
                                    "modelPreference",
                                    m.value
                                  );
                                  openModelDropdown.value = null;
                                }}
                                class="w-full text-left px-2 py-1 text-[11px] hover:bg-gray-100 text-gray-800"
                              >
                                {m.label}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <label
                      htmlFor={thinkingSelectId}
                      class="text-[10px] text-gray-500 w-12 shrink-0"
                    >
                      Thinking
                    </label>
                    <select
                      id={thinkingSelectId}
                      class="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-700 flex-1 min-w-0"
                      value={skill.thinkingLevel || ""}
                      onChange={(e) =>
                        updateSkillField(
                          skill.repo,
                          "thinkingLevel",
                          (e.target as HTMLSelectElement).value
                        )
                      }
                    >
                      <option value="">Default</option>
                      <option value="off">Off</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              )}

              {hasSubItems && skill.enabled && (
                <div class="ml-6 pl-2 border-l-2 border-purple-100 space-y-1">
                  {[
                    ...ownedIntegrations.map((ig) => ({
                      key: `skill-ig-${ig.id}`,
                      badge: ig.authType || "oauth",
                      name: ig.label || ig.id,
                      status: ig.connected ? "connected" : "not connected",
                      statusColor: ig.connected
                        ? "text-green-600"
                        : "text-gray-400",
                    })),
                    ...ownedMcps.map((m) => ({
                      key: `skill-mcp-${m.id}`,
                      badge: "mcp",
                      name: m.name || m.id,
                      status: "included",
                      statusColor: "text-gray-500",
                    })),
                  ].map((item) => (
                    <SubItem
                      key={item.key}
                      badge={item.badge}
                      badgeColor="bg-gray-100 text-gray-600"
                      name={item.name}
                      status={item.status}
                      statusColor={item.statusColor}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {ctx.isAdmin && <SkillRegistriesSubsection />}
    </Section>
  );
}

function SkillRegistriesSubsection() {
  const ctx = useSettings();
  const showAdd = useSignal(false);
  const newId = useSignal("");
  const newType = useSignal("clawhub");
  const newUrl = useSignal("");
  const addError = useSignal("");

  function removeRegistry(id: string) {
    ctx.registries.value = ctx.registries.value.filter((r) => r.id !== id);
  }

  function handleAdd() {
    addError.value = "";
    const id = newId.value.trim();
    const type = newType.value;
    const apiUrl = newUrl.value.trim();
    if (!id || !apiUrl) {
      addError.value = "ID and URL are required";
      return;
    }
    const allIds = [
      ...ctx.globalRegistries.map((r) => r.id),
      ...ctx.registries.value.map((r) => r.id),
    ];
    if (allIds.includes(id)) {
      addError.value = `Registry "${id}" already exists`;
      return;
    }
    ctx.registries.value = [...ctx.registries.value, { id, type, apiUrl }];
    showAdd.value = false;
    newId.value = "";
    newType.value = "clawhub";
    newUrl.value = "";
  }

  const hasEntries =
    ctx.globalRegistries.length > 0 || ctx.registries.value.length > 0;

  return (
    <div class="mt-4 pt-3 border-t border-gray-200">
      <h4 class="text-xs font-semibold text-gray-700 mb-2">Skill Registries</h4>
      <div class="space-y-1.5">
        {ctx.globalRegistries.map((r) => (
          <RegistryRow key={`global-${r.id}`} registry={r} kind="default" />
        ))}
        {ctx.registries.value.map((r) => (
          <RegistryRow
            key={`custom-${r.id}`}
            registry={r}
            kind="custom"
            onRemove={ctx.isSandbox ? undefined : () => removeRegistry(r.id)}
          />
        ))}
        {!hasEntries && !showAdd.value && (
          <p class="text-xs text-gray-500">No skill registries configured.</p>
        )}

        {showAdd.value && !ctx.isSandbox ? (
          <div class="bg-gray-50 rounded-lg p-2.5 space-y-2">
            <div class="flex items-center gap-2">
              <input
                type="text"
                placeholder="ID"
                class="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                value={newId.value}
                onInput={(e: any) => {
                  newId.value = e.target.value;
                }}
              />
              <select
                class="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
                value={newType.value}
                onChange={(e: any) => {
                  newType.value = e.target.value;
                }}
              >
                <option value="clawhub">clawhub</option>
                <option value="lobu">lobu</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="API URL"
              class="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
              value={newUrl.value}
              onInput={(e: any) => {
                newUrl.value = e.target.value;
              }}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            {addError.value && (
              <span class="text-[10px] text-red-500">{addError.value}</span>
            )}
            <div class="flex gap-2">
              <button
                type="button"
                class="text-xs px-3 py-1.5 font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all"
                onClick={handleAdd}
              >
                Add
              </button>
              <button
                type="button"
                class="text-xs px-3 py-1.5 font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                onClick={() => {
                  showAdd.value = false;
                  addError.value = "";
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : !ctx.isSandbox ? (
          <button
            type="button"
            class="w-full py-1.5 text-xs font-medium rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-slate-400 hover:text-slate-600 transition-colors"
            onClick={() => {
              showAdd.value = true;
            }}
          >
            + Add Registry
          </button>
        ) : (
          <p class="text-xs text-gray-500">
            Manage registries from the base agent. Sandbox pages show the active
            registry set but do not create new ones.
          </p>
        )}
      </div>
    </div>
  );
}

function RegistryRow({
  registry,
  kind,
  onRemove,
}: {
  registry: RegistryEntry;
  kind: "default" | "custom";
  onRemove?: () => void;
}) {
  const badgeColor =
    kind === "default"
      ? "bg-slate-100 text-slate-600"
      : "bg-blue-100 text-blue-700";
  return (
    <div class="flex items-center justify-between p-2 bg-white rounded border border-gray-100">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span
          class={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${badgeColor}`}
        >
          {kind}
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium text-gray-800 truncate">
            {registry.id}
            <span class="ml-1 text-[10px] text-gray-400">{registry.type}</span>
          </p>
          <p class="text-xs text-gray-500 truncate">{registry.apiUrl}</p>
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          class="ml-2 px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 flex-shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}
