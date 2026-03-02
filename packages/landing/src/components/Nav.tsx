const GITHUB_URL = "https://github.com/lobu-ai/lobu";
const GITHUB_STARS_BADGE =
  "https://img.shields.io/github/stars/lobu-ai/lobu?style=social";

export function Nav() {
  return (
    <nav
      class="fixed top-0 left-0 right-0 z-50 px-4 py-3"
      style={{
        backgroundColor: "var(--color-page-bg-overlay)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--color-page-border)",
      }}
    >
      <div class="max-w-5xl mx-auto flex items-center justify-between">
        <a
          href="/"
          class="flex items-center gap-2 text-lg font-bold tracking-tight"
          style={{ color: "var(--color-page-text)" }}
        >
          <img src="/lobster-icon.png" alt="Lobu" class="w-7 h-7" />
          Lobu
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <img src={GITHUB_STARS_BADGE} alt="GitHub stars" height="20" />
        </a>
      </div>
    </nav>
  );
}
