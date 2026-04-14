import type { LandingUseCaseId } from "../use-case-definitions";
import {
  getLandingUseCaseShowcase,
  getOwlettoUrl,
  landingUseCaseOptions,
} from "../use-case-showcases";
import { formatUseCaseSummaryTitle, UseCaseSummary } from "./UseCaseSummary";
import { UseCaseTabs } from "./UseCaseTabs";

const ApiIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M4 17l6-6-6-6M12 19h8" />
  </svg>
);

const GITHUB_URL = "https://github.com/lobu-ai/lobu";

export function HeroSection(props: {
  activeUseCaseId?: LandingUseCaseId;
  onActiveUseCaseChange?: (id: LandingUseCaseId) => void;
  linkTabsToCampaigns?: boolean;
}) {
  const activeUseCase = getLandingUseCaseShowcase(props.activeUseCaseId);
  const memoryHref = `/memory/for/${activeUseCase.id}`;
  const skillsHref = `/skills/for/${activeUseCase.id}`;
  const owlettoUrl = getOwlettoUrl(activeUseCase.id);

  return (
    <section class="pt-24 pb-4 px-8 relative">
      <div class="max-w-5xl mx-auto text-center relative">
        <h1
          class="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5"
          style={{ color: "var(--color-page-text)" }}
        >
          Your{" "}
          <span
            style={{
              color: "var(--color-tg-accent)",
            }}
          >
            AI team
          </span>
          , running in your infrastructure
        </h1>
        <p
          class="text-lg mx-auto mb-4 leading-relaxed"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          <a
            href="/guides/security"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            Sandboxed
          </a>{" "}
          persistent agents powered by the{" "}
          <a
            href="/getting-started/comparison/"
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            OpenClaw harness
          </a>
          , <br />
          <a
            href={memoryHref}
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            long-term memory
          </a>{" "}
          and installable{" "}
          <a
            href={skillsHref}
            class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            skills
          </a>
          .
        </p>
        {/* CTA buttons */}
        <div class="flex flex-wrap gap-3 mb-6 justify-center items-center">
          <a
            href={owlettoUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              backgroundColor: "var(--color-page-text)",
              color: "var(--color-page-bg)",
            }}
          >
            Open in Owletto
          </a>
          <a
            href={`${GITHUB_URL}/tree/main/examples/${activeUseCase.examplePath}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium px-5 py-2.5 rounded-lg transition-all hover:opacity-90"
            style={{
              color: "var(--color-page-text-muted)",
              border: "1px solid var(--color-page-border)",
            }}
          >
            <ApiIcon />
            See example
          </a>
        </div>

        <div class="mt-8 mb-6">
          <UseCaseTabs
            tabs={landingUseCaseOptions}
            activeId={activeUseCase.id}
            label="Pick a use case"
            onSelect={
              props.linkTabsToCampaigns
                ? undefined
                : (id) => props.onActiveUseCaseChange?.(id as LandingUseCaseId)
            }
            hrefForId={
              props.linkTabsToCampaigns ? (id) => `/for/${id}` : undefined
            }
          />
          <UseCaseSummary
            title={formatUseCaseSummaryTitle(activeUseCase.label)}
            description={activeUseCase.memory.description}
            className="mt-4 mb-0"
          />
        </div>
      </div>
    </section>
  );
}
