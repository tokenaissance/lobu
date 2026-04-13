type UseCaseTab = {
  id: string;
  label: string;
};

type UseCaseTabsProps = {
  tabs: UseCaseTab[];
  activeId: string;
  onSelect?: (id: string) => void;
  hrefForId?: (id: string) => string;
  className?: string;
};

export function UseCaseTabs({
  tabs,
  activeId,
  onSelect,
  hrefForId,
  className = "",
}: UseCaseTabsProps) {
  return (
    <div class={`flex flex-wrap items-center justify-center gap-2 ${className}`.trim()}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const commonClass =
          "px-3 py-2 rounded-xl text-sm font-medium transition-colors";
        const commonStyle = {
          backgroundColor: active
            ? "rgba(122,162,247,0.16)"
            : "var(--color-page-surface)",
          color: active
            ? "var(--color-page-text)"
            : "var(--color-page-text-muted)",
          border: "1px solid var(--color-page-border)",
        };

        if (hrefForId) {
          return (
            <a
              key={tab.id}
              href={hrefForId(tab.id)}
              class={commonClass}
              style={commonStyle}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </a>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect?.(tab.id)}
            class={`${commonClass} cursor-pointer`}
            style={commonStyle}
            aria-pressed={active}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
