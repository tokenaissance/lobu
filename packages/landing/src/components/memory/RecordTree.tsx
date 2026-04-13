import type { RecordNode } from "../../memory-examples";
import {
  accentAmber,
  accentCyan,
  accentPink,
  accentPurple,
  cardBorderFaint,
  innerCardBg,
  labelGray,
  textColor,
  textMuted,
} from "./styles";

export function getNodeAccentStyle(node: RecordNode) {
  const kind = node.kind.toLowerCase();
  const label = node.label.toLowerCase();

  if (kind === "relationship" || label.startsWith("relationship:")) {
    return {
      accent: accentCyan,
      borderColor: "rgba(103, 232, 249, 0.45)",
      background:
        "linear-gradient(180deg, rgba(103, 232, 249, 0.12), rgba(103, 232, 249, 0.05))",
      boxShadow: "0 0 0 1px rgba(103,232,249,0.16) inset",
      badgeBackground: "rgba(103, 232, 249, 0.08)",
      badgeBorder: "1px solid rgba(103, 232, 249, 0.22)",
    };
  }

  if (
    kind.includes("task") ||
    kind.includes("preference") ||
    kind.includes("operational memory") ||
    kind.includes("pending decision") ||
    kind.includes("renewal risk") ||
    label.startsWith("task:") ||
    label.startsWith("preference:")
  ) {
    return {
      accent: accentPink,
      borderColor: "rgba(251, 113, 133, 0.45)",
      background:
        "linear-gradient(180deg, rgba(251, 113, 133, 0.12), rgba(251, 113, 133, 0.05))",
      boxShadow: "0 0 0 1px rgba(251,113,133,0.16) inset",
      badgeBackground: "rgba(251, 113, 133, 0.08)",
      badgeBorder: "1px solid rgba(251, 113, 133, 0.22)",
    };
  }

  if (kind === "field") {
    return {
      accent: accentAmber,
      borderColor: "rgba(248, 184, 78, 0.45)",
      background:
        "linear-gradient(180deg, rgba(248, 184, 78, 0.12), rgba(248, 184, 78, 0.05))",
      boxShadow: "0 0 0 1px rgba(248,184,78,0.16) inset",
      badgeBackground: "rgba(248, 184, 78, 0.08)",
      badgeBorder: "1px solid rgba(248, 184, 78, 0.22)",
    };
  }

  return {
    accent: accentPurple,
    borderColor: "rgba(192, 132, 252, 0.45)",
    background:
      "linear-gradient(180deg, rgba(192, 132, 252, 0.12), rgba(192, 132, 252, 0.05))",
    boxShadow: "0 0 0 1px rgba(192,132,252,0.16) inset",
    badgeBackground: "rgba(192, 132, 252, 0.08)",
    badgeBorder: "1px solid rgba(192, 132, 252, 0.22)",
  };
}

export function RecordTree(props: {
  node: RecordNode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const { node, selectedId, onSelect, depth = 0 } = props;
  const isSelected = node.id === selectedId;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const accentStyle = getNodeAccentStyle(node);

  return (
    <div class="grid gap-2 min-w-0">
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        class="w-full text-left rounded-2xl p-3 border transition-all hover:-translate-y-0.5"
        style={{
          borderColor: isSelected ? accentStyle.borderColor : cardBorderFaint,
          background: isSelected ? accentStyle.background : innerCardBg,
          boxShadow: isSelected ? accentStyle.boxShadow : "none",
        }}
      >
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span
            class="text-[11px] uppercase tracking-[0.18em]"
            style={{ color: isSelected ? accentStyle.accent : labelGray }}
          >
            {node.kind}
          </span>
          {hasChildren && (
            <span
              class="text-[11px] px-2 py-0.5 rounded-full"
              style={{
                color: textMuted,
                backgroundColor: "rgba(255,255,255,0.05)",
              }}
            >
              {node.children?.length} sub-record
              {node.children?.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div class="text-sm font-semibold mb-1" style={{ color: textColor }}>
          {node.label}
        </div>
        <div class="text-sm leading-6" style={{ color: textMuted }}>
          {node.summary}
        </div>
      </button>

      {hasChildren && (
        <div
          class="grid gap-2 ml-3 pl-3 min-w-0"
          style={{
            borderLeft:
              depth === 0
                ? "1px solid rgba(103, 232, 249, 0.18)"
                : `1px solid rgba(62, 77, 97, 0.32)`,
          }}
        >
          {(node.children ?? []).map((child) => (
            <RecordTree
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
