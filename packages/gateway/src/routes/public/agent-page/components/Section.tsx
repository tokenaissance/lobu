import type { ComponentChildren } from "preact";
import { useSettings } from "../app";

interface SectionProps {
  id: string;
  title: string;
  icon: string;
  badge?: ComponentChildren;
  adminOnly?: boolean;
  children: ComponentChildren;
}

export function Section({
  id,
  title,
  icon,
  badge,
  adminOnly,
  children,
}: SectionProps) {
  const { openSections, toggleSection } = useSettings();
  const isOpen = openSections.value[id];

  return (
    <div class="bg-gray-50 rounded-lg p-3">
      <h3
        class="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer select-none"
        onClick={() => toggleSection(id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggleSection(id);
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: icon }} />
        {title}
        {adminOnly && (
          <span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            hidden from user
          </span>
        )}
        {badge}
        <span
          class={`ml-auto text-xs text-gray-400 transition-transform ${isOpen ? "" : "rotate-[-90deg]"}`}
        >
          &#9660;
        </span>
      </h3>
      {isOpen && <div class="pt-3">{children}</div>}
    </div>
  );
}
