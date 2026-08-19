type Translator = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
) => string

const pluralRulesCache = new Map<string, Intl.PluralRules>()

function pluralRulesFor(locale: string): Intl.PluralRules {
  const cached = pluralRulesCache.get(locale)
  if (cached) return cached
  let rules: Intl.PluralRules
  try {
    rules = new Intl.PluralRules(locale)
  } catch {
    rules = new Intl.PluralRules('en')
  }
  pluralRulesCache.set(locale, rules)
  return rules
}

export function translatePlural(
  translate: Translator,
  locale: string,
  baseKey: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  const category = pluralRulesFor(locale).select(count)
  const mergedParams = { count, ...(params ?? {}) }
  for (const key of [`${baseKey}.${category}`, `${baseKey}.other`, baseKey]) {
    const result = translate(key, mergedParams)
    if (result !== key) return result
  }
  return translate(baseKey, mergedParams)
}
