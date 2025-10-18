import registry from 'language-subtag-registry/data/json/registry.json'

type RegistryEntry = {
  Type: string
  Subtag?: string
  Description?: string[]
  Deprecated?: string
}

export type IsoCountry = {
  code: string
  name: string
}

function isIsoAlpha2(entry: RegistryEntry): entry is RegistryEntry & { Subtag: string; Description: string[] } {
  if (entry.Type !== 'region') return false
  if (!entry.Subtag || !/^[A-Z]{2}$/.test(entry.Subtag)) return false
  if (entry.Deprecated) return false
  if (!entry.Description || !entry.Description.length) return false
  if (entry.Description[0] === 'Private use') return false
  return true
}

const RAW_COUNTRIES: IsoCountry[] = (registry as RegistryEntry[])
  .filter(isIsoAlpha2)
  .map((entry) => ({
    code: entry.Subtag,
    name: entry.Description.join(', '),
  }))

export const ISO_COUNTRIES: IsoCountry[] = [...RAW_COUNTRIES].sort((a, b) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
)

export const COUNTRY_PRIORITY: string[] = ['PL', 'DE', 'ES', 'FR', 'IT', 'US', 'GB', 'CA']

const displayNameCache = new Map<string, Intl.DisplayNames>()

function getDisplayNames(locale: string): Intl.DisplayNames | null {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames === 'undefined') return null
  const key = locale || 'en'
  let instance = displayNameCache.get(key)
  if (!instance) {
    try {
      instance = new Intl.DisplayNames([key], { type: 'region' })
      displayNameCache.set(key, instance)
    } catch {
      return null
    }
  }
  return instance
}

export function resolveCountryName(code: string, options: { locale?: string } = {}): string {
  const normalized = code.toUpperCase()
  const fallback = ISO_COUNTRIES.find((entry) => entry.code === normalized)?.name ?? normalized
  const displayNames = getDisplayNames(options.locale ?? 'en')
  if (!displayNames) return fallback
  try {
    const label = displayNames.of(normalized as any)
    return typeof label === 'string' ? label : fallback
  } catch {
    return fallback
  }
}

export function buildCountryOptions(options: {
  locale?: string
  priority?: string[]
  transformLabel?: (code: string, defaultLabel: string) => string
} = {}): Array<{ code: string; label: string }> {
  const { locale, transformLabel } = options
  const priority = (options.priority ?? COUNTRY_PRIORITY).map((code) => code.toUpperCase())
  const prioritySet = new Set(priority)
  const labelFor = (code: string) => {
    const base = resolveCountryName(code, { locale })
    return transformLabel ? transformLabel(code, base) : base
  }

  const byCode = new Map(ISO_COUNTRIES.map((entry) => [entry.code, entry]))

  const prioritized = priority
    .map((code) => {
      const base = byCode.get(code)
      if (!base) return null
      return { code, label: labelFor(code) }
    })
    .filter((entry): entry is { code: string; label: string } => !!entry)
    .sort((a, b) => a.label.localeCompare(b.label, locale ?? 'en', { sensitivity: 'base' }))

  const remaining = ISO_COUNTRIES
    .filter((entry) => !prioritySet.has(entry.code))
    .map((entry) => ({ code: entry.code, label: labelFor(entry.code) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale ?? 'en', { sensitivity: 'base' }))

  return [...prioritized, ...remaining]
}
