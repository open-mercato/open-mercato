export type DictionaryLabelKind = 'reason' | 'fault' | 'rejection'

const PREFIX: Record<DictionaryLabelKind, string> = {
  reason: 'warranty_claims.reasonOption',
  fault: 'warranty_claims.faultOption',
  rejection: 'warranty_claims.rejectionOption',
}

export function localizeDictionaryLabel(
  t: (key: string, fallback?: string) => string,
  kind: DictionaryLabelKind,
  value: string,
  fallbackLabel: string,
): string {
  return t(`${PREFIX[kind]}.${value}`, fallbackLabel)
}
