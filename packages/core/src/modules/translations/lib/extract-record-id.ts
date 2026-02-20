export function extractRecordId(params: Record<string, string | string[]>): string | undefined {
  if (params.id) return String(Array.isArray(params.id) ? params.id[0] : params.id)
  for (const [, value] of Object.entries(params)) {
    const segments = Array.isArray(value) ? value : [value]
    for (const seg of segments) {
      if (seg && /^[0-9a-f-]{20,}$/i.test(seg)) return seg
    }
  }
  return undefined
}
