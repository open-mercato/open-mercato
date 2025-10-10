import type { Dict } from './context'

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string
export type TranslateWithFallbackFn = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string

function format(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

export function createTranslator(dict: Dict): TranslateFn {
  return (key, params) => format(dict[key] ?? key, params)
}

export function translateWithFallback(
  t: TranslateFn,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  const value = t(key, params)
  return value === key ? fallback : value
}

export function createFallbackTranslator(dict: Dict): TranslateWithFallbackFn {
  const t = createTranslator(dict)
  return (key, fallback, params) => translateWithFallback(t, key, fallback, params)
}
