export function normalizeCustomFieldKey(raw: string): string {
  if (raw.startsWith('cf_')) return raw
  if (raw.startsWith('cf:')) return `cf_${raw.slice(3)}`
  return `cf_${raw}`
}
