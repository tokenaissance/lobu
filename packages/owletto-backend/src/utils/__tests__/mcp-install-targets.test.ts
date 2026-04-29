import { describe, expect, it } from 'vitest';
import { getMcpInstallTargets } from '../../../../owletto-web/src/lib/mcp-install-targets';

describe('getMcpInstallTargets', () => {
  const mcpUrl = 'http://localhost:4821/mcp/public-owletto';

  it('returns all first-class MCP targets', () => {
    const targets = getMcpInstallTargets(mcpUrl);

    expect(targets.map((target) => target.id)).toEqual([
      'codex',
      'chatgpt',
      'claude-desktop',
      'claude-code',
      'gemini-cli',
      'cursor',
      'openclaw',
    ]);
  });

  it('uses the runtime mcpUrl in generated commands', () => {
    const targets = getMcpInstallTargets(mcpUrl);
    const codex = targets.find((target) => target.id === 'codex');
    const openclaw = targets.find((target) => target.id === 'openclaw');

    expect(codex?.actions).toContainEqual({
      type: 'command',
      label: 'Add MCP server',
      value: `codex mcp add owletto --url ${mcpUrl}`,
    });

    const openclawCommands = openclaw?.actions.filter(
      (action): action is { type: 'command'; label: string; value: string } =>
        action.type === 'command'
    );
    expect(openclawCommands?.length).toBeGreaterThan(0);
    expect(openclawCommands?.some((action) => action.value.includes(mcpUrl))).toBe(true);
  });

  it('encodes the runtime mcpUrl into the Cursor install link', () => {
    const targets = getMcpInstallTargets(mcpUrl);
    const cursor = targets.find((target) => target.id === 'cursor');
    const link = cursor?.actions.find((action) => action.type === 'link');

    expect(link?.type).toBe('link');

    const href = new URL((link as { href: string }).href);
    expect(href.searchParams.get('name')).toBe('owletto');

    const encodedConfig = href.searchParams.get('config');
    expect(encodedConfig).toBeTruthy();

    const configJson = Buffer.from(encodedConfig!, 'base64').toString('utf-8');
    expect(JSON.parse(configJson)).toEqual({ url: mcpUrl });
  });
});
