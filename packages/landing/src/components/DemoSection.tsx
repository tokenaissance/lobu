import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import { useCases } from "../use-cases";
import {
  ConnectionsPanel,
  IntegrationsPanel,
  MemoryPanel,
  ModelsPanel,
  PackagesPanel,
  PermissionsPanel,
  RemindersPanel,
} from "./SettingsPanels";
import { TelegramChat } from "./TelegramChat";

const PANEL_MAP: Record<string, ComponentType> = {
  connections: ConnectionsPanel,
  setup: ModelsPanel,
  packages: PackagesPanel,
  skills: IntegrationsPanel,
  schedules: RemindersPanel,
  network: PermissionsPanel,
  memory: MemoryPanel,
};

function TimelineDot() {
  return (
    <div
      class="w-3 h-3 rounded-full shrink-0 my-1"
      style={{
        backgroundColor: "var(--color-tg-accent)",
        opacity: 0.5,
      }}
    />
  );
}

function FeatureRow({
  uc,
  isFirst,
  isLast,
}: {
  uc: (typeof useCases)[0];
  isFirst: boolean;
  isLast: boolean;
}) {
  const Panel = PANEL_MAP[uc.id];
  const [panelHighlight, setPanelHighlight] = useState(false);

  return (
    <>
      {/* Left cell */}
      <div class="pb-8 md:pb-10 md:text-right md:pr-4">
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
          class="text-sm leading-relaxed md:ml-auto max-w-md"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.description}
        </p>
        {uc.learnMoreUrl && (
          <a
            href={uc.learnMoreUrl}
            class="inline-block text-xs font-medium mt-2 mb-4 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-tg-accent)" }}
          >
            Learn more →
          </a>
        )}
        {!uc.learnMoreUrl && <div class="mb-6" />}
        <p
          class="text-xs font-medium mb-2"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.settingsLabel}
        </p>
        <div
          class="md:text-left transition-all duration-300"
          style={{
            transform: panelHighlight ? "scale(1.02)" : "scale(1)",
            boxShadow: panelHighlight
              ? "0 0 20px rgba(249, 115, 22, 0.15)"
              : "none",
            borderRadius: "12px",
          }}
        >
          <Panel />
        </div>
      </div>

      {/* Center cell — timeline */}
      <div class="hidden md:flex flex-col items-center">
        {isFirst ? (
          <div class="h-2" />
        ) : (
          <div
            class="w-px flex-1"
            style={{ backgroundColor: "var(--color-page-border)" }}
          />
        )}
        <TimelineDot />
        {isLast ? (
          <div class="h-2" />
        ) : (
          <div
            class="w-px flex-1"
            style={{ backgroundColor: "var(--color-page-border)" }}
          />
        )}
      </div>

      {/* Right cell */}
      <div class="pb-8 md:pb-10 md:pl-4">
        <p
          class="text-xs font-medium mb-2"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {uc.chatLabel}
        </p>
        <TelegramChat useCase={uc} onButtonHover={setPanelHighlight} />
      </div>
    </>
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

        {/* Single grid — timeline column is continuous across all rows */}
        <div class="grid grid-cols-1 md:grid-cols-[1fr_40px_1fr] gap-4 md:gap-x-6 md:gap-y-0">
          {useCases.map((uc, i) => (
            <FeatureRow
              key={uc.id}
              uc={uc}
              isFirst={i === 0}
              isLast={i === useCases.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
