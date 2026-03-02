import type { Signal } from "@preact/signals";
import { InstructionsSection } from "@settings/components/InstructionsSection";
import { IntegrationsSection } from "@settings/components/IntegrationsSection";
import { NixPackagesSection } from "@settings/components/NixPackagesSection";
import { PermissionsSection } from "@settings/components/PermissionsSection";
import { ProviderSection } from "@settings/components/ProviderSection";
import { RemindersSection } from "@settings/components/RemindersSection";
import { SecretsSection } from "@settings/components/SecretsSection";
import { MockSettingsProvider } from "../settings-mock/mock-context";

export function SettingsDemo({
  openSections,
}: {
  openSections?: Signal<Record<string, boolean>>;
}) {
  return (
    <div
      class="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Phone-style header */}
      <div
        class="flex items-center justify-between px-4 py-2.5"
        style={{
          backgroundColor: "var(--color-page-bg-elevated)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
            style={{
              background: "var(--color-tg-accent)",
            }}
          >
            L
          </div>
          <span class="text-xs font-semibold text-white/80">
            Agent Settings
          </span>
        </div>
        <div class="flex gap-1.5">
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
          <span
            class="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
          />
        </div>
      </div>

      {/* Settings content — real components, fixed height so accordions scroll */}
      <div class="bg-white h-[480px] overflow-y-auto">
        <MockSettingsProvider openSections={openSections}>
          <div class="p-3 space-y-3">
            <ProviderSection />
            <InstructionsSection />
            <IntegrationsSection />
            <RemindersSection />
            <PermissionsSection />
            <NixPackagesSection />
            <SecretsSection />
          </div>
        </MockSettingsProvider>
      </div>
    </div>
  );
}
