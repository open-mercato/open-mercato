"use client"
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import type { Locale } from './config'
import { getLocaleDirection, type TextDirection } from './direction'
import { getSupportedLocales } from './locale-set'

export type Dict = Record<string, string>

export type TranslateParams = Record<string, string | number>

export type TranslateFn = (
  key: string,
  fallbackOrParams?: string | TranslateParams,
  params?: TranslateParams
) => string

export type I18nContextValue = {
  locale: Locale
  /**
   * The direction `locale` renders in. A server layout puts the same value on
   * `<html dir>`, so a client component that needs to mirror layout reads it
   * here instead of inspecting the DOM.
   */
  direction: TextDirection
  t: TranslateFn
  /** True when the locale is pinned via `OM_FORCE_LOCALE`; UI should hide switchers. */
  localeLocked: boolean
  /**
   * Every locale this app serves. Resolved on the server (where the app
   * registry and any tenant configuration are readable) and handed to the
   * client, because a client bundle cannot see either.
   */
  supportedLocales: readonly Locale[]
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

export function I18nProvider({ children, locale, dict, localeLocked, supportedLocales, direction }: PropsWithChildren<{ locale: Locale; dict: Dict; localeLocked?: boolean; supportedLocales?: readonly Locale[]; direction?: TextDirection }>) {
  // A nested provider (the backend layout mounts one inside the root layout's)
  // shadows the whole subtree, so a prop it does not pass would otherwise be
  // silently downgraded to the registry default for every consumer below it.
  // Inheriting from the enclosing provider first makes an omitted prop mean
  // "unchanged" rather than "reset", which is what a nested mount intends.
  const outer = useContext(I18nContext)
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    // Derived from this provider's own locale rather than inherited from an
    // enclosing one: a nested mount that switches locale has to switch direction
    // with it. The explicit prop — what the root layout passes — always wins.
    direction: direction ?? getLocaleDirection(locale),
    localeLocked: localeLocked ?? outer?.localeLocked ?? false,
    // Falls back to the process-local registry so a provider mounted without the
    // prop and without an enclosing one (tests, standalone renders) behaves
    // exactly as it did before.
    supportedLocales: supportedLocales ?? outer?.supportedLocales ?? getSupportedLocales(),
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
  }), [locale, dict, localeLocked, supportedLocales, direction, outer])
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
 * Like `useLocale`, but returns `undefined` instead of throwing when no
 * `I18nProvider` is in scope. Use in shared components that receive their
 * translator as a prop and may render outside a provider (galleries, tests).
 */
export function useOptionalLocale(): Locale | undefined {
  const ctx = useContext(I18nContext)
  return ctx?.locale
}

/**
 * The text direction of the active locale, for components that have to mirror
 * layout (icons, chevrons, timelines) or pass a direction to a primitive.
 * Falls back to `ltr` outside a provider so callers can render unconditionally.
 */
export function useDirection(): TextDirection {
  const ctx = useContext(I18nContext)
  return ctx?.direction ?? 'ltr'
}

/**
 * Every locale this app serves, for rendering a language picker. Falls back to
 * the process-local registry outside a provider so callers can render
 * unconditionally.
 */
export function useSupportedLocales(): readonly Locale[] {
  const ctx = useContext(I18nContext)
  return ctx?.supportedLocales ?? getSupportedLocales()
}

/**
 * True when the active locale is pinned via `OM_FORCE_LOCALE`. Returns `false`
 * when no provider is in scope so callers can render unconditionally.
 */
export function useLocaleLocked() {
  const ctx = useContext(I18nContext)
  return ctx?.localeLocked ?? false
}
