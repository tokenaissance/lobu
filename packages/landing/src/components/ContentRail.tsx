import type { ComponentChildren } from "preact";

type ContentRailProps = {
  children: ComponentChildren;
  className?: string;
  variant?: "page" | "inset";
};

const railClasses = {
  page: "w-full max-w-[72rem] mx-auto",
  inset: "w-full max-w-[68rem] mx-auto px-4 sm:px-6 box-border",
};

export function ContentRail({
  children,
  className = "",
  variant = "inset",
}: ContentRailProps) {
  return <div class={`${railClasses[variant]} ${className}`.trim()}>{children}</div>;
}
