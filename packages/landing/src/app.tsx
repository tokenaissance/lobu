import { ArchitectureSection } from "./components/ArchitectureSection";
import { CTA } from "./components/CTA";
import { DemoSection } from "./components/DemoSection";
import { Footer } from "./components/Footer";
import { HeroSection } from "./components/HeroSection";
import { InstallSection } from "./components/InstallSection";
import { Nav } from "./components/Nav";

function SectionDivider() {
  return <div class="section-divider" />;
}

export function App() {
  return (
    <div
      class="min-h-screen grid-lines"
      style={{ backgroundColor: "var(--color-page-bg)" }}
    >
      <Nav />
      <main class="relative z-[1]">
        <HeroSection />
        <SectionDivider />
        <DemoSection />
        <SectionDivider />
        <ArchitectureSection />
        <SectionDivider />
        <InstallSection />
        <SectionDivider />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
