export type Dictionary = Record<string, string>
export type TranslateValues = Record<string, string | number>

export function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey: string | undefined, singleKey: string | undefined) => {
    const key = doubleKey ?? singleKey
    if (!key || values[key] === undefined) return match
    return String(values[key])
  })
}

export function createTranslator(dictionary: Dictionary) {
  return (key: string, fallback?: string, values?: TranslateValues): string =>
    interpolate(dictionary[key] ?? fallback ?? key, values)
}
