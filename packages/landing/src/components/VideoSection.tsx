import { useEffect, useRef } from "preact/hooks";

export function VideoSection() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const timer = setTimeout(() => {
            video.muted = true;
            video.play().catch(() => undefined);
          }, 2000);
          observer.disconnect();
          return () => clearTimeout(timer);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section class="py-14 px-8">
      <div class="max-w-4xl mx-auto">
        <div
          class="rounded-xl overflow-hidden border"
          style={{
            borderColor: "var(--color-page-border)",
            backgroundColor: "var(--color-page-card)",
          }}
        >
          <video
            ref={videoRef}
            controls
            muted
            preload="metadata"
            class="w-full block"
            style={{ borderRadius: "inherit" }}
          >
            <source src="/demo.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  );
}
