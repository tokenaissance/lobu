import type { ComponentChildren } from "preact";

type CompactContentRailProps = {
  children: ComponentChildren;
  className?: string;
};

export function CompactContentRail({
  children,
  className = "",
}: CompactContentRailProps) {
  return <div class={`max-w-[60rem] mx-auto ${className}`.trim()}>{children}</div>;
}
