export type SecretRef = string;

export interface ParsedSecretRef {
  raw: SecretRef;
  scheme: string;
  path: string;
  fragment?: string;
}

const SECRET_REF_RE = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i;

export function parseSecretRef(value: string): ParsedSecretRef | null {
  const match = value.match(SECRET_REF_RE);
  if (!match) return null;

  const scheme = match[1]?.toLowerCase();
  const remainder = match[2];
  if (!scheme || !remainder) return null;

  const [path, fragment] = remainder.split("#", 2);
  if (!path) return null;

  return {
    raw: value,
    scheme,
    path,
    ...(fragment ? { fragment } : {}),
  };
}

export function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === "string" && parseSecretRef(value) !== null;
}

export function createBuiltinSecretRef(name: string): SecretRef {
  return `secret://${name}`;
}
