import type { Dict } from './context'

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string
export type TranslateWithFallbackFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string

function format(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey
    if (!key) return match
    const value = params[key]
    if (value === undefined) return match
    return String(value)
  })
}

export function createTranslator(dict: Dict): TranslateFn {
  return (key, params) => format(dict[key] ?? key, params)
}

export function translateWithFallback(
  t: TranslateFn,
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
): string {
  const value = t(key, params)
  if (value !== key) return value
  if (fallback === undefined) return key
  return format(fallback, params)
}

export function createTranslatorWithFallback(translate: TranslateFn): TranslateWithFallbackFn {
  return (key, fallback, params) => translateWithFallback(translate, key, fallback, params)
}

export function createFallbackTranslator(dict: Dict): TranslateWithFallbackFn {
  const t = createTranslator(dict)
  return (key, fallback, params) => translateWithFallback(t, key, fallback, params)
}
