"use client"
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Locale } from './config'

export type Dict = Record<string, string>

export type TranslateParams = Record<string, string | number>

export type TranslateFn = (
  key: string,
  fallbackOrParams?: string | TranslateParams,
  params?: TranslateParams
) => string

export type I18nContextValue = {
  locale: Locale
  t: TranslateFn
  /** True when the locale is pinned via `OM_FORCE_LOCALE`; UI should hide switchers. */
  localeLocked: boolean
}

const I18N_CONTEXT_KEY = '__openMercatoI18nContext'

type GlobalI18nContextStore = typeof globalThis & {
  [I18N_CONTEXT_KEY]?: ReturnType<typeof createContext<I18nContextValue | null>>
}

function getI18nContext() {
  const store = globalThis as GlobalI18nContextStore
  if (!store[I18N_CONTEXT_KEY]) {
    store[I18N_CONTEXT_KEY] = createContext<I18nContextValue | null>(null)
  }
  return store[I18N_CONTEXT_KEY]
}

const I18nContext = getI18nContext()

function format(template: string, params?: TranslateParams) {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey
    if (!key) return _
    const value = params[key]
    if (value === undefined) {
      return doubleKey ? `{{${key}}}` : `{${key}}`
    }
    return String(value)
  })
}

export function I18nProvider({ children, locale, dict, localeLocked = false }: { children: ReactNode; locale: Locale; dict: Dict; localeLocked?: boolean }) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    localeLocked,
    t: (key, fallbackOrParams, params) => {
      let fallback: string | undefined
      let resolvedParams: TranslateParams | undefined

      if (typeof fallbackOrParams === 'string') {
        fallback = fallbackOrParams
        resolvedParams = params
      } else {
        resolvedParams = fallbackOrParams ?? params
      }

      const template = dict[key] ?? fallback ?? key
      return format(template, resolvedParams)
    },
  }), [locale, dict, localeLocked])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx.t
}

/**
 * Like `useT`, but returns `undefined` instead of throwing when no
 * `I18nProvider` is in scope. Use where a translator is desirable but not
 * guaranteed (e.g. plumbing `t` into side-effect handlers that may run before
 * the provider mounts) — callers MUST provide a fallback.
 */
export function useOptionalT(): TranslateFn | undefined {
  const ctx = useContext(I18nContext)
  return ctx?.t
}

export function useLocale() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useLocale must be used within I18nProvider')
  return ctx.locale
}

/**
 * True when the active locale is pinned via `OM_FORCE_LOCALE`. Returns `false`
 * when no provider is in scope so callers can render unconditionally.
 */
export function useLocaleLocked() {
  const ctx = useContext(I18nContext)
  return ctx?.localeLocked ?? false
}
