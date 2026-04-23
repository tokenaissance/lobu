import { describe, expect, test } from "bun:test";
import { __testOnly } from "../proxy/gemini-oauth/proxy";

describe("Gemini OAuth proxy schema sanitization", () => {
  test("dereferences local definitions before stripping vendor extensions", async () => {
    const sanitized = await __testOnly.sanitizeToolSchema({
      type: "object",
      properties: {
        kind: { const: "appointment" },
        meta: { $ref: "#/$defs/Meta" },
      },
      required: ["kind", "meta"],
      patternProperties: {
        "^x-": { type: "string" },
      },
      $defs: {
        Meta: {
          type: "object",
          properties: {
            patientId: { type: "string" },
          },
          required: ["patientId"],
        },
      },
    });

    expect(sanitized).toEqual({
      type: "object",
      properties: {
        kind: { enum: ["appointment"] },
        meta: {
          type: "object",
          properties: {
            patientId: { type: "string" },
          },
          required: ["patientId"],
        },
      },
      required: ["kind", "meta"],
      additionalProperties: true,
    });
    const encoded = JSON.stringify(sanitized);
    expect(encoded).not.toContain("$ref");
    expect(encoded).not.toContain("$defs");
    expect(encoded).not.toContain("x-");
  });

  test("sanitizes function declaration parameters in request bodies", async () => {
    const body = {
      request: {
        tools: [
          {
            functionDeclarations: [
              {
                name: "lookup",
                parameters: {
                  type: "object",
                  properties: {
                    id: { const: "abc" },
                  },
                },
              },
            ],
          },
        ],
      },
    };

    await __testOnly.sanitizeRequestBody(body);

    const req = body.request as {
      tools: Array<{
        functionDeclarations: Array<{ parameters: unknown }>;
      }>;
    };
    expect(req.tools[0]?.functionDeclarations[0]?.parameters).toEqual({
      type: "object",
      properties: {
        id: { enum: ["abc"] },
      },
    });
  });

  test("does not resolve external references from tool schemas", async () => {
    const sanitized = await __testOnly.sanitizeToolSchema({
      type: "object",
      properties: {
        external: { $ref: "https://example.invalid/schema.json" },
      },
    });

    expect(sanitized).toEqual({
      type: "object",
      properties: {
        external: { $ref: "https://example.invalid/schema.json" },
      },
    });
  });
});
