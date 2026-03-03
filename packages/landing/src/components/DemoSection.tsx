import type { ComponentType } from "preact";
import { useCases } from "../use-cases";
import {
  IntegrationsPanel,
  ModelsPanel,
  PackagesPanel,
  PermissionsPanel,
  RemindersPanel,
} from "./SettingsPanels";
import { TelegramChat } from "./TelegramChat";

const PANEL_MAP: Record<string, ComponentType> = {
  setup: ModelsPanel,
  packages: PackagesPanel,
  skills: IntegrationsPanel,
  schedules: RemindersPanel,
  network: PermissionsPanel,
};

function FeatureRow({
  uc,
  index,
  isLast,
}: {
  uc: (typeof useCases)[0];
  index: number;
  isLast: boolean;
}) {
  const Panel = PANEL_MAP[uc.id];

  return (
    <div class="grid grid-cols-1 md:grid-cols-[1fr_40px_1fr] gap-4 md:gap-6">
      {/* Left column: title + settings panel */}
      <div class="pb-8 md:pb-12 md:text-right md:pr-4">
        <div
          class="text-xs font-semibold uppercase tracking-wider mb-1"
          style={{ color: "var(--color-tg-accent)" }}
        >
          {uc.tabLabel}
        </div>
        <h3
          class="text-xl font-bold mb-2"
          style={{ color: "var(--color-page-text)" }}
        >
          {uc.title}
        </h3>
        <p
          class="text-sm leading-relaxed mb-6 md:ml-auto max-w-md"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.description}
        </p>
        <p
          class="text-xs font-medium mb-2"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.settingsLabel}
        </p>
        <div class="md:text-left">
          <Panel />
        </div>
      </div>

      {/* Timeline column (center) */}
      <div class="hidden md:flex flex-col items-center">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{
            backgroundColor: "rgba(var(--color-tg-accent-rgb), 0.15)",
            color: "var(--color-tg-accent)",
            border: "1px solid rgba(var(--color-tg-accent-rgb), 0.3)",
          }}
        >
          {index + 1}
        </div>
        {!isLast && (
          <div
            class="w-px flex-1 mt-2"
            style={{ backgroundColor: "var(--color-page-border)" }}
          />
        )}
      </div>

      {/* Right column: chat */}
      <div class="pb-8 md:pb-12 md:pl-4">
        <p
          class="text-xs font-medium mb-2"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.chatLabel}
        </p>
        <TelegramChat useCase={uc} />
      </div>
    </div>
  );
}

export function DemoSection() {
  return (
    <section id="how-it-works" class="py-14 px-8">
      <div class="max-w-[60rem] mx-auto">
        <h2
          class="text-2xl sm:text-3xl font-bold text-center mb-12 tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          How it works
        </h2>

        <div>
          {useCases.map((uc, i) => (
            <FeatureRow
              key={uc.id}
              uc={uc}
              index={i}
              isLast={i === useCases.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
