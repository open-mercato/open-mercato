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

export function I18nProvider({ children, locale, dict }: { children: ReactNode; locale: Locale; dict: Dict }) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
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
  }), [locale, dict])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useT must be used within I18nProvider')
  return ctx.t
}

export function useLocale() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useLocale must be used within I18nProvider')
  return ctx.locale
}
