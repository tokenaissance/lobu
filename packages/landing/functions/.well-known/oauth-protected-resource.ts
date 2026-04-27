/**
 * RFC 9728 Protected Resource Metadata for `https://lobu.ai/mcp`.
 *
 * Served as static JSON rather than proxied upstream because the `resource`
 * field MUST match the scanned host. Proxying `app.lobu.ai/.well-known/...`
 * would return `resource: https://app.lobu.ai/mcp`, which validators flag as
 * a mismatch when fetched from `lobu.ai`. The authorization server lives on
 * `app.lobu.ai`, so clients still complete OAuth there.
 */

type PagesFunction = (context: {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, unknown>;
  params: Record<string, string | string[]>;
}) => Promise<Response> | Response;

const METADATA = {
  resource: "https://lobu.ai/mcp",
  authorization_servers: ["https://app.lobu.ai"],
  scopes_supported: ["mcp:read", "mcp:write", "mcp:admin", "profile:read"],
  bearer_methods_supported: ["header"],
  resource_name: "Lobu",
  resource_documentation: "https://lobu.ai/mcp",
};

export const onRequest: PagesFunction = (context) => {
  const method = context.request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "access-control-allow-origin": "*",
      },
    });
  }

  const body = method === "HEAD" ? null : JSON.stringify(METADATA);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD",
      vary: "Accept",
    },
  });
};
