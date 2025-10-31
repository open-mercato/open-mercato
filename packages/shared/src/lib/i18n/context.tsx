"use client"
import React, { createContext, useContext, useMemo } from 'react'
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

const I18nContext = createContext<I18nContextValue | null>(null)

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

export function I18nProvider({ children, locale, dict }: { children: React.ReactNode; locale: Locale; dict: Dict }) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, fallbackOrParams, params) => {
      let fallback: string | undefined
      let resolvedParams: TranslateParams | undefined

      if (typeof fallbackOrParams === 'string') {
        fallback = fallbackOrParams
        resolvedParams = params
      } else {
        resolvedParams = fallbackOrParams
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
