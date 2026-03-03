import { describe, expect, test } from "bun:test";
import { extractSettingsLinkButtons } from "../platform/link-buttons";

describe("extractSettingsLinkButtons", () => {
  test("extracts settings link and replaces with label", () => {
    const content =
      "Click [Open Settings](https://example.com/settings#st=abc123) to continue";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(1);
    expect(linkButtons[0]!.text).toBe("Open Settings");
    expect(linkButtons[0]!.url).toBe("https://example.com/settings#st=abc123");
    expect(processedContent).toBe("Click Open Settings to continue");
    expect(processedContent).not.toContain("https://");
  });

  test("extracts settings link with query param (?st=)", () => {
    const content = "[Settings](https://example.com/settings?st=token123)";
    const { linkButtons } = extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(1);
    expect(linkButtons[0]!.url).toBe(
      "https://example.com/settings?st=token123"
    );
  });

  test("extracts multiple settings links", () => {
    const content =
      "[First](https://a.com/settings#st=1) and [Second](https://b.com/settings#st=2)";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(2);
    expect(processedContent).toBe("First and Second");
  });

  test("filters out localhost URLs", () => {
    const content = "[Settings](http://localhost:3000/settings#st=token)";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(0);
    // Label still replaces the link
    expect(processedContent).toBe("Settings");
  });

  test("filters out 127.0.0.1 URLs", () => {
    const content = "[Settings](http://127.0.0.1/settings#st=token)";
    const { linkButtons } = extractSettingsLinkButtons(content);
    expect(linkButtons).toHaveLength(0);
  });

  test("does not match non-settings links", () => {
    const content = "[Home](https://example.com/home)";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(0);
    expect(processedContent).toBe(content); // unchanged
  });

  test("does not match links without st= parameter", () => {
    const content = "[Settings](https://example.com/settings)";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(0);
    expect(processedContent).toBe(content);
  });

  test("returns empty buttons for content without links", () => {
    const content = "No links here, just plain text";
    const { processedContent, linkButtons } =
      extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(0);
    expect(processedContent).toBe(content);
  });

  test("handles HTTP and HTTPS", () => {
    const httpContent = "[A](http://example.com/settings#st=x)";
    const httpsContent = "[B](https://example.com/settings#st=y)";

    const httpResult = extractSettingsLinkButtons(httpContent);
    const httpsResult = extractSettingsLinkButtons(httpsContent);

    expect(httpResult.linkButtons).toHaveLength(1);
    expect(httpsResult.linkButtons).toHaveLength(1);
  });

  test("mixed localhost and remote links only keeps remote", () => {
    const content =
      "[Local](http://localhost/settings#st=a) and [Remote](https://app.com/settings#st=b)";
    const { linkButtons } = extractSettingsLinkButtons(content);

    expect(linkButtons).toHaveLength(1);
    expect(linkButtons[0]!.url).toContain("app.com");
  });
});
