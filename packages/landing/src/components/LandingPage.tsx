import { useState } from "preact/hooks";
import type { LandingUseCaseId } from "../use-case-definitions";
import { DEFAULT_LANDING_USE_CASE_ID } from "../use-case-showcases";
import { ArchitectureSection } from "./ArchitectureSection";
import { CTA } from "./CTA";
import { DemoSection } from "./DemoSection";
import { HeroSection } from "./HeroSection";

export function LandingPage(props: {
  defaultUseCaseId?: LandingUseCaseId;
  linkTabsToCampaigns?: boolean;
}) {
  const [activeUseCaseId, setActiveUseCaseId] = useState<LandingUseCaseId>(
    props.defaultUseCaseId ?? DEFAULT_LANDING_USE_CASE_ID
  );

  return (
    <>
      <HeroSection
        activeUseCaseId={activeUseCaseId}
        onActiveUseCaseChange={setActiveUseCaseId}
        linkTabsToCampaigns={props.linkTabsToCampaigns}

      />
      <DemoSection
        activeUseCaseId={activeUseCaseId}
        onActiveUseCaseChange={setActiveUseCaseId}
        showTabs={false}
        linkTabsToCampaigns={props.linkTabsToCampaigns}
      />
      <div class="hidden md:block">
        <div class="section-divider" />
        <ArchitectureSection />
        <div class="section-divider" />
      </div>
      <CTA />
    </>
  );
}
