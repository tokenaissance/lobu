import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { LandingUseCaseId } from "../use-case-definitions";
import {
  DEFAULT_LANDING_USE_CASE_ID,
  getLandingUseCaseShowcase,
  landingUseCaseOptions,
} from "../use-case-showcases";
import { deliverySurfaces } from "./platforms";
import { UseCaseTabs } from "./UseCaseTabs";

function Card({
  title,
  description,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  children: ComponentChildren;
}) {
  return (
    <div
      class="rounded-2xl p-6 h-full"
      style={{
        backgroundColor: "var(--color-page-bg-elevated)",
        border: "1px solid var(--color-page-border)",
      }}
    >
      <div class="flex items-center justify-between gap-3 mb-2">
        <h3
          class="text-lg font-semibold"
          style={{ color: "var(--color-page-text)" }}
        >
          {title}
        </h3>
        {href ? (
          <a
            href={href}
            class="text-sm font-medium transition-opacity hover:opacity-80 shrink-0"
            style={{ color: "var(--color-tg-accent)" }}
          >
            {hrefLabel ?? `${title} page`} →
          </a>
        ) : null}
      </div>
      {description ? (
        <p
          class="text-sm leading-relaxed mb-4"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function PillList({ items }: { items: string[] }) {
  return (
    <div class="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          class="text-[11px] font-medium px-2 py-1 rounded-full"
          style={{
            color: "var(--color-page-text-muted)",
            backgroundColor: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function StepsList({
  steps,
}: {
  steps: Array<{ title: string; detail: string; chips?: string[] }>;
}) {
  return (
    <div class="grid gap-4">
      {steps.map((step, index) => (
        <div key={step.title} class="grid gap-2">
          <div class="flex items-start gap-3">
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                color: "var(--color-page-bg)",
                backgroundColor: "var(--color-tg-accent)",
              }}
            >
              {index + 1}
            </div>
            <div class="min-w-0">
              <div
                class="text-sm font-semibold mb-1"
                style={{ color: "var(--color-page-text)" }}
              >
                {step.title}
              </div>
              <div
                class="text-sm leading-6"
                style={{ color: "var(--color-page-text-muted)" }}
              >
                {step.detail}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestBlock({
  label,
  text,
  showPlatforms = false,
}: {
  label: string;
  text: string;
  showPlatforms?: boolean;
}) {
  return (
    <div
      class="rounded-xl p-4 mb-5"
      style={{
        backgroundColor: "rgba(0,0,0,0.28)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div
        class="text-[10px] uppercase tracking-[0.18em] mb-2"
        style={{ color: "var(--color-page-text-muted)" }}
      >
        {label}
      </div>
      <div
        class="text-sm leading-7"
        style={{ color: "var(--color-page-text)" }}
      >
        {text}
      </div>
      {showPlatforms ? (
        <div class="flex flex-wrap gap-2 mt-4">
          {deliverySurfaces.map((surface) => (
            <a
              key={surface.id}
              href={surface.href}
              class="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
              style={{
                color: "var(--color-page-text-muted)",
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span class="shrink-0" aria-hidden="true">
                {surface.renderIcon(12)}
              </span>
              {surface.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HighlightGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div class="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} class="grid gap-0.5">
          <div
            class="text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--color-page-text-muted)" }}
          >
            {item.label}
          </div>
          <div class="text-sm" style={{ color: "var(--color-page-text)" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DemoSection(props: {
  defaultUseCaseId?: LandingUseCaseId;
  activeUseCaseId?: LandingUseCaseId;
  onActiveUseCaseChange?: (id: LandingUseCaseId) => void;
  showTabs?: boolean;

  linkTabsToCampaigns?: boolean;
}) {
  const [internalUseCaseId, setInternalUseCaseId] = useState(
    props.activeUseCaseId ?? props.defaultUseCaseId ?? DEFAULT_LANDING_USE_CASE_ID
  );

  useEffect(() => {
    if (props.activeUseCaseId) {
      setInternalUseCaseId(props.activeUseCaseId);
    }
  }, [props.activeUseCaseId]);

  const resolvedUseCaseId =
    props.activeUseCaseId ?? internalUseCaseId ?? props.defaultUseCaseId;
  const activeUseCase = useMemo(
    () => getLandingUseCaseShowcase(resolvedUseCaseId),
    [resolvedUseCaseId]
  );

  return (
    <section id="how-it-works" class="pt-4 pb-14 px-8">
      <div class="w-full max-w-[72rem] mx-auto px-2 sm:px-6 lg:px-6 box-border">
        {props.showTabs === false ? null : (
          <UseCaseTabs
            tabs={landingUseCaseOptions}
            activeId={activeUseCase.id}
            onSelect={
              props.linkTabsToCampaigns
                ? undefined
                : (id) => {
                    const nextId = id as LandingUseCaseId;
                    props.onActiveUseCaseChange?.(nextId);
                    if (props.activeUseCaseId === undefined) {
                      setInternalUseCaseId(nextId);
                    }
                  }
            }
            hrefForId={props.linkTabsToCampaigns ? (id) => `/for/${id}` : undefined}
            className="mb-6"
          />
        )}

        <div class="mb-6">
          <Card
            title="Runtime"
            description={activeUseCase.runtime.summary}
          >
            <RequestBlock
              label={activeUseCase.runtime.requestLabel}
              text={activeUseCase.runtime.request}
              showPlatforms
            />
            <StepsList steps={activeUseCase.runtime.steps} />
          </Card>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card
            title="Skill bundle"
            description={activeUseCase.skills.description}
            href="/skills"
            hrefLabel="Skills page"
          >
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <div
                  class="text-[10px] uppercase tracking-[0.18em] mb-2"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  Skills
                </div>
                <PillList items={activeUseCase.skills.skills} />
              </div>
              <div>
                <div
                  class="text-[10px] uppercase tracking-[0.18em] mb-2"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  Allowed domains
                </div>
                <PillList items={activeUseCase.skills.allowedDomains} />
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 mt-5">
              <div class="grid gap-0.5">
                <div
                  class="text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  Agent
                </div>
                <div class="text-sm" style={{ color: "var(--color-page-text)" }}>
                  {activeUseCase.skills.agentId}
                </div>
              </div>
              <div class="grid gap-0.5">
                <div
                  class="text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  MCP server
                </div>
                <div class="text-sm" style={{ color: "var(--color-page-text)" }}>
                  {activeUseCase.skills.mcpServer}
                </div>
              </div>
              <div class="grid gap-0.5">
                <div
                  class="text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  Provider
                </div>
                <div class="text-sm" style={{ color: "var(--color-page-text)" }}>
                  {activeUseCase.skills.providerId}
                </div>
              </div>
              <div class="grid gap-0.5">
                <div
                  class="text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: "var(--color-page-text-muted)" }}
                >
                  Model
                </div>
                <div class="text-sm" style={{ color: "var(--color-page-text)" }}>
                  {activeUseCase.skills.model}
                </div>
              </div>
            </div>
            <div class="mt-5 grid gap-2">
              {activeUseCase.skills.skillInstructions.map((instruction) => (
                <div
                  key={instruction}
                  class="rounded-lg px-3 py-2 text-sm leading-6"
                  style={{
                    color: "var(--color-page-text)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {instruction}
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Memory"
            description={activeUseCase.memory.description}
            href="/memory"
            hrefLabel="Memory page"
          >
            <RequestBlock
              label={activeUseCase.memory.sourceLabel}
              text={activeUseCase.memory.sourceText}
            />
            <HighlightGrid items={activeUseCase.memory.highlights} />
            <div class="mt-5">
              <div
                class="text-[10px] uppercase tracking-[0.18em] mb-2"
                style={{ color: "var(--color-page-text-muted)" }}
              >
                Structured entities
              </div>
              <PillList items={activeUseCase.memory.entityTypes} />
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
