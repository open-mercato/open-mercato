export const REFERENCE_UNIT_CODES = ['kg', 'l', 'm2', 'm3', 'pc'] as const;
export type ReferenceUnitCode = (typeof REFERENCE_UNIT_CODES)[number];

const LEGACY_UNIT_CODE_ALIASES: Record<string, string> = {
  qty: "pc",
};

export function canonicalizeUnitCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const alias = LEGACY_UNIT_CODE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

export function toUnitLookupKey(value: unknown): string | null {
  const canonical = canonicalizeUnitCode(value);
  if (!canonical) return null;
  return canonical.toLowerCase();
}
