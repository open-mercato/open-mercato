"use client"
import React, { createContext, useContext, useMemo } from 'react'
import type { Locale } from './config'

export type Dict = Record<string, string>

export type I18nContextValue = {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function format(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}

export function I18nProvider({ children, locale, dict }: { children: React.ReactNode; locale: Locale; dict: Dict }) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, params) => format(dict[key] ?? key, params),
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

