const KEY_NAME = /(secret|token|password|passwd|api[-_]?key|authorization|credential|private[-_]?key)/i;
const VALUE_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:sk|rk|pk)-(?:live|test)-[A-Za-z0-9_-]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
];

export const REDACTED = "[REDACTED]";

export function redactString(value: string, maxLength = 64_000): string {
  let result = value;
  for (const pattern of VALUE_PATTERNS) result = result.replace(pattern, REDACTED);
  result = result.replace(/\b(https?:\/\/)[^/\s"'<>]+@/gi, `$1${REDACTED}@`);
  result = result.replace(
    /((?:[A-Za-z0-9_-]*(?:secret|token|password|passwd|api[-_]?key|authorization|credential|private[-_]?key)[A-Za-z0-9_-]*)\s*[=:]\s*["']?)(?!\[REDACTED\])([^\s,"'<>]{4,})/gi,
    `$1${REDACTED}`
  );
  return result.slice(0, maxLength);
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return "[TRUNCATED]" as T;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redact(item, depth + 1)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 500)) {
      output[key] = KEY_NAME.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return output as T;
  }
  return value;
}

export function redactKnown<T>(value: T, knownSecrets: readonly string[]): T {
  const redacted = redact(value);
  const replace = (item: unknown, depth = 0): unknown => {
    if (depth > 12) return "[TRUNCATED]";
    if (typeof item === "string") {
      return knownSecrets.filter((secret) => secret.length >= 8).reduce((text, secret) => text.split(secret).join(REDACTED), item);
    }
    if (Array.isArray(item)) return item.map((child) => replace(child, depth + 1));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child, depth + 1)]));
    return item;
  };
  return replace(redacted) as T;
}
