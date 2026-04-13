import { useState } from "preact/hooks";
import {
  capabilityLenses,
  examples,
  sharedActStep,
  sharedRecallStep,
  type RecordNode,
} from "../../memory-examples";
import { getNodeAccentStyle, RecordTree } from "./RecordTree";
import {
  accentAmber,
  accentCyan,
  accentGreen,
  accentPink,
  accentPurple,
  cardBg,
  cardBorder,
  cardBorderSubtle,
  darkBase,
  deepBg,
  innerCardBg,
  innerCardBgLight,
  labelGray,
  textColor,
  textMuted,
} from "./styles";

function findRecordNode(node: RecordNode, id: string): RecordNode | null {
  if (node.id === id) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findRecordNode(child, id);
    if (found) {
      return found;
    }
  }

  return null;
}

function getDefaultSelectedNodeId(example: (typeof examples)[number]) {
  return (
    Object.values(example.entitySelections ?? {})[0] ?? example.recordTree.id
  );
}

export function ExampleShowcase() {
  const [activeExampleId, setActiveExampleId] = useState(examples[0].id);
  const [selectedNodeId, setSelectedNodeId] = useState(
    getDefaultSelectedNodeId(examples[0])
  );

  const activeExample =
    examples.find((e) => e.id === activeExampleId) ?? examples[0];
  const selectedNode =
    findRecordNode(activeExample.recordTree, selectedNodeId) ??
    activeExample.recordTree;
  const selectedHighlights =
    activeExample.nodeHighlights?.[selectedNode.id] ?? activeExample.highlights;
  const selectedNodeAccent = getNodeAccentStyle(selectedNode);

  const switchExample = (id: string) => {
    const next = examples.find((e) => e.id === id) ?? examples[0];
    setActiveExampleId(next.id);
    setSelectedNodeId(getDefaultSelectedNodeId(next));
  };

  return (
    <div class="px-2 sm:px-3 pt-1">
      <div class="mb-6">
        <div class="grid gap-y-2 w-fit max-w-full mx-auto">
          {capabilityLenses.map((lens) => (
            <div
              key={lens.title}
              class="grid grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-x-3 text-left"
            >
              <span
                class="text-xs uppercase tracking-[0.18em] font-semibold text-right"
                style={{ color: lens.accent }}
              >
                {lens.title}
              </span>
              <span class="text-sm" style={{ color: textMuted }}>
                {lens.body}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div class="mb-5">
        <div
          class="rounded-[2rem] border overflow-hidden"
          style={{
            background: cardBg,
            borderColor: cardBorder,
            boxShadow: "0 18px 48px rgba(0, 0, 0, 0.18)",
          }}
        >
          <div class="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4">
            <div
              class="text-xs uppercase tracking-[0.24em] mb-3"
              style={{ color: labelGray }}
            >
              {activeExample.sourceLabel}
            </div>
            <p
              class="text-lg sm:text-[1rem] lg:text-[1.05rem] leading-8 sm:leading-9 m-0"
              style={{ color: textColor }}
            >
              {activeExample.sourceText}
            </p>
          </div>

          <div
            class="px-3 sm:px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2"
            style={{
              borderColor: cardBorderSubtle,
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
          >
            <div class="flex flex-wrap gap-2">
              Pick an example:
              {examples.map((example) => {
                const active = example.id === activeExample.id;
                return (
                  <button
                    key={example.id}
                    type="button"
                    onClick={() => switchExample(example.id)}
                    class="px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all hover:-translate-y-0.5"
                    style={{
                      color: active ? darkBase : textColor,
                      backgroundColor: active
                        ? "var(--color-tg-accent)"
                        : innerCardBgLight,
                      borderColor: active
                        ? "rgba(248, 184, 78, 0.72)"
                        : "rgba(70, 85, 105, 0.72)",
                      boxShadow: active
                        ? "0 8px 24px rgba(248, 184, 78, 0.16)"
                        : "none",
                    }}
                  >
                    {example.tab}
                  </button>
                );
              })}
            </div>

            <div
              class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium border"
              style={{
                color: textMuted,
                backgroundColor: innerCardBg,
                borderColor: cardBorderSubtle,
              }}
            >
              <span
                class="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                style={{
                  color: darkBase,
                  backgroundColor: "var(--color-tg-accent)",
                }}
              >
                →
              </span>
              Send message
            </div>
          </div>
        </div>
      </div>

      <div class="grid gap-5 lg:grid-cols-2 mt-5">
        <div class="min-w-0 lg:order-2">
          <div
            class="rounded-3xl p-4 border"
            style={{
              backgroundColor: innerCardBg,
              borderColor: cardBorderSubtle,
            }}
          >
            <h3
              class="text-xl tracking-[-0.03em] mt-0 mb-2"
              style={{ color: textColor }}
            >
              Structured memory
            </h3>
            <p class="text-sm leading-6 m-0 mb-5" style={{ color: textMuted }}>
              Click any node to inspect what Owletto wrote into the record tree.
            </p>
            <RecordTree
              node={activeExample.recordTree}
              selectedId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
          </div>
        </div>

        <div class="min-w-0 lg:order-1">
          <div
            class="rounded-3xl p-4 border"
            style={{
              background:
                "linear-gradient(180deg, rgba(19, 24, 28, 0.82), rgba(13, 16, 20, 0.78))",
              borderColor: "rgba(62, 77, 97, 0.52)",
            }}
          >
            <h3
              class="text-xl tracking-[-0.03em] mt-0 mb-2"
              style={{ color: textColor }}
            >
              How your agent works
            </h3>
            <p class="text-sm leading-6 m-0 mb-5" style={{ color: textMuted }}>
              One prompt is extracted, normalized, linked, recalled, and kept
              fresh by watchers.
            </p>

            <div class="grid gap-4">
              {activeExample.transformation.map((step, index) => {
                const colors = [accentPurple, accentAmber, accentCyan];
                const color = colors[index] ?? labelGray;

                return (
                  <div key={step.label} class="grid gap-2">
                    <div class="flex items-start gap-3">
                      <div
                        class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                        style={{ color: darkBase, backgroundColor: color }}
                      >
                        {step.label}
                      </div>
                      <div class="min-w-0 pt-0.5">
                        <div
                          class="text-sm font-semibold mb-1"
                          style={{ color: textColor }}
                        >
                          {step.title}
                        </div>
                        <div
                          class="text-sm leading-6"
                          style={{ color: textMuted }}
                        >
                          {step.detail}
                        </div>
                      </div>
                    </div>

                    {index === 0 && (
                      <div class="flex flex-wrap gap-1.5 ml-10">
                        {activeExample.entityTypes.map((type) => {
                          const targetNodeId =
                            activeExample.entitySelections?.[type];
                          const isActive = targetNodeId === selectedNodeId;

                          if (!targetNodeId) {
                            return (
                              <span
                                key={type}
                                class="px-3 py-1 rounded-full text-xs"
                                style={{
                                  color: textColor,
                                  backgroundColor: "rgba(192, 132, 252, 0.08)",
                                  border: "1px solid rgba(192, 132, 252, 0.28)",
                                }}
                              >
                                {type}
                              </span>
                            );
                          }

                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setSelectedNodeId(targetNodeId)}
                              class="px-3 py-1 rounded-full text-xs border transition-all hover:-translate-y-0.5"
                              style={{
                                color: isActive ? darkBase : textColor,
                                backgroundColor: isActive
                                  ? accentPurple
                                  : "rgba(192, 132, 252, 0.08)",
                                borderColor: isActive
                                  ? "rgba(192, 132, 252, 0.72)"
                                  : "rgba(192, 132, 252, 0.28)",
                                boxShadow: isActive
                                  ? "0 8px 24px rgba(192, 132, 252, 0.16)"
                                  : "none",
                              }}
                            >
                              {type}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {index === 1 && (
                      <div
                        class="rounded-xl p-3 border ml-10 min-h-[14rem]"
                        style={{
                          backgroundColor: deepBg,
                          borderColor: cardBorderSubtle,
                        }}
                      >
                        <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <div class="grid gap-0.5">
                            <div
                              class="text-[10px] uppercase tracking-[0.18em]"
                              style={{ color: "#9fb3d1" }}
                            >
                              Selected node
                            </div>
                            <div
                              class="text-sm font-semibold"
                              style={{ color: textColor }}
                            >
                              {selectedNode.label}
                            </div>
                          </div>
                          <span
                            class="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em]"
                            style={{
                              color: selectedNodeAccent.accent,
                              backgroundColor:
                                selectedNodeAccent.badgeBackground,
                              border: selectedNodeAccent.badgeBorder,
                            }}
                          >
                            {selectedNode.kind}
                          </span>
                        </div>
                        <div class="grid gap-2 sm:grid-cols-2">
                          {selectedHighlights.map((highlight) => (
                            <div key={highlight.label} class="grid gap-0.5">
                              <div
                                class="text-[10px] uppercase tracking-[0.2em]"
                                style={{ color: "#9fb3d1" }}
                              >
                                {highlight.label}
                              </div>
                              <div class="text-sm" style={{ color: textColor }}>
                                {highlight.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {index === 2 && (
                      <div class="grid gap-1.5 ml-10">
                        {activeExample.relations.map((relation) => (
                          <div
                            key={`${relation.source}-${relation.label}`}
                            class="flex flex-wrap items-center gap-1.5"
                          >
                            <span
                              class="px-2 py-0.5 rounded-full text-xs"
                              style={{
                                color: textColor,
                                backgroundColor: "rgba(103, 232, 249, 0.08)",
                                border: "1px solid rgba(103, 232, 249, 0.22)",
                              }}
                            >
                              {relation.source}
                            </span>
                            <span
                              class="px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.16em]"
                              style={{
                                color: accentCyan,
                                backgroundColor: "rgba(103, 232, 249, 0.06)",
                                border: "1px solid rgba(103, 232, 249, 0.18)",
                              }}
                            >
                              {relation.label}
                            </span>
                            <span
                              class="px-2 py-0.5 rounded-full text-xs"
                              style={{
                                color: textColor,
                                backgroundColor: "rgba(134, 239, 172, 0.08)",
                                border: "1px solid rgba(134, 239, 172, 0.22)",
                              }}
                            >
                              {relation.target}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Shared steps — same for all examples */}
              {[
                { step: sharedRecallStep, color: accentGreen },
                { step: sharedActStep, color: accentPink },
              ].map(({ step, color }) => (
                <div key={step.label} class="grid gap-2">
                  <div class="flex items-start gap-3">
                    <div
                      class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      style={{ color: darkBase, backgroundColor: color }}
                    >
                      {step.label}
                    </div>
                    <div class="min-w-0 pt-0.5">
                      <div
                        class="text-sm font-semibold mb-1"
                        style={{ color: textColor }}
                      >
                        {step.title}
                      </div>
                      <div
                        class="text-sm leading-6"
                        style={{ color: textMuted }}
                      >
                        {step.detail}
                      </div>
                    </div>
                  </div>

                  {step === sharedActStep && (
                    <div
                      class="rounded-xl p-3 border ml-10"
                      style={{
                        backgroundColor: deepBg,
                        borderColor: "rgba(251, 113, 133, 0.22)",
                      }}
                    >
                      <div class="flex flex-wrap items-center gap-2 mb-3">
                        <span
                          class="text-sm font-semibold"
                          style={{ color: textColor }}
                        >
                          {activeExample.watcher.name}
                        </span>
                        <span
                          class="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.14em]"
                          style={{
                            color: accentPink,
                            backgroundColor: "rgba(251, 113, 133, 0.08)",
                            border: "1px solid rgba(251, 113, 133, 0.22)",
                          }}
                        >
                          {activeExample.watcher.schedule}
                        </span>
                      </div>
                      <div class="grid gap-2">
                        <div>
                          <div
                            class="text-xs leading-5"
                            style={{ color: textMuted }}
                          >
                            {activeExample.watcher.prompt}
                          </div>
                        </div>
                        <div>
                          <div
                            class="text-[10px] uppercase tracking-[0.18em] mb-0.5"
                            style={{ color: accentPink }}
                          >
                            Extraction schema
                          </div>
                          <code
                            class="text-[11px] leading-5 block px-2 py-1.5 rounded-lg"
                            style={{
                              color: textColor,
                              backgroundColor: "rgba(251, 113, 133, 0.06)",
                              border: "1px solid rgba(251, 113, 133, 0.14)",
                            }}
                          >
                            {activeExample.watcher.extractionSchema}
                          </code>
                        </div>
                        <div>
                          <div
                            class="text-[10px] uppercase tracking-[0.18em] mb-0.5"
                            style={{ color: accentPink }}
                          >
                            Schema evolution
                          </div>
                          <div
                            class="text-xs leading-5"
                            style={{ color: textMuted }}
                          >
                            {activeExample.watcher.schemaEvolution}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
