type UseCaseSummaryProps = {
  title: string;
  description: string;
  className?: string;
};

export function formatUseCaseSummaryTitle(
  label: string,
  prefix = "Lobu for "
) {
  return prefix ? `${prefix}${label}` : label;
}

export function UseCaseSummary({
  title,
  description,
  className = "",
}: UseCaseSummaryProps) {
  return (
    <div class={`mb-6 text-center max-w-2xl mx-auto ${className}`.trim()}>
      <h2
        class="text-2xl sm:text-[2rem] tracking-[-0.03em] mt-0 mb-3"
        style={{ color: "var(--color-page-text)" }}
      >
        {title}
      </h2>
      <p
        class="text-sm leading-7 m-0"
        style={{ color: "var(--color-page-text-muted)" }}
      >
        {description}
      </p>
    </div>
  );
}
