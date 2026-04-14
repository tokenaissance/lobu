const GITHUB_URL = "https://github.com/lobu-ai/lobu";

export function Footer() {
  return (
    <footer
      class="py-8 px-8 mt-8"
      style={{ borderTop: "1px solid var(--color-page-border)" }}
    >
      <div class="max-w-[60rem] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div
          class="flex items-center gap-2 text-sm"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          <span
            class="font-semibold"
            style={{ color: "var(--color-page-text)" }}
          >
            Lobu
          </span>
          <span>&copy; {new Date().getFullYear()}</span>
        </div>
        <div
          class="flex items-center gap-5 text-xs"
          style={{ color: "var(--color-page-text-muted)" }}
        >
          <a href="/terms" class="hover:underline">
            Terms
          </a>
          <a href="/privacy" class="hover:underline">
            Privacy
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="hover:underline"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
