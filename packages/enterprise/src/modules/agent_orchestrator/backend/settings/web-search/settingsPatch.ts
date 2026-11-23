import type { InstalledAdapter } from './AdapterRow'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildSettingsPatch(
  values: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const saved = baseline[key]
    if (JSON.stringify(value ?? null) === JSON.stringify(saved ?? null)) return []
    if ((key === 'guardrails' || key === 'adapterOptions') && isRecord(value) && isRecord(saved)) {
      const changed = Object.fromEntries(Object.entries(value).filter(([field, next]) => (
        JSON.stringify(next ?? null) !== JSON.stringify(saved[field] ?? null)
      )))
      return Object.keys(changed).length ? [[key, changed]] : []
    }
    return [[key, value]]
  }))
}

type AdapterOptions = Record<string, Record<string, unknown>>

export function reconcileSavedAdapterSecrets(
  current: AdapterOptions,
  submitted: AdapterOptions,
  installed: InstalledAdapter[],
): AdapterOptions {
  const next = { ...current }
  for (const adapter of installed) {
    const sent = submitted[adapter.id]
    if (!sent) continue
    const edited = current[adapter.id] ?? {}
    const options = { ...edited }
    for (const field of adapter.fields) {
      if (!field.secret || edited[field.name] !== sent[field.name]) continue
      if (Object.hasOwn(adapter.options, field.name)) options[field.name] = adapter.options[field.name]
      else delete options[field.name]
    }
    next[adapter.id] = options
  }
  return next
}
