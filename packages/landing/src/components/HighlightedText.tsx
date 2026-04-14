export function HighlightedText(props: { text: string; highlight?: string }) {
  if (!props.highlight) return <>{props.text}</>;

  const highlightIndex = props.text.indexOf(props.highlight);

  if (highlightIndex === -1) return <>{props.text}</>;

  const before = props.text.slice(0, highlightIndex);
  const after = props.text.slice(highlightIndex + props.highlight.length);

  return (
    <>
      {before}
      <span style={{ color: "var(--color-tg-accent)" }}>{props.highlight}</span>
      {after}
    </>
  );
}
