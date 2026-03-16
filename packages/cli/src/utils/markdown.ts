import { marked, type MarkedExtension } from "marked";
// @ts-expect-error -- no type declarations
import { markedTerminal } from "marked-terminal";

marked.use(markedTerminal() as MarkedExtension);

/** Parse markdown and return ANSI-styled terminal text. */
export function renderMarkdown(text: string): string {
  const result = marked.parse(text) as string;
  return result.replace(/\n+$/, "");
}
