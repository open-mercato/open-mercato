/**
 * The set of languages the platform ships dictionaries for.
 *
 * `Locale` is derived from `LocaleRegistry` rather than written as a closed
 * union so that a downstream application can serve a language the platform does
 * not ship, without patching or forking `@open-mercato/shared`. Augment the
 * interface from the app and the new code becomes a valid `Locale` everywhere:
 *
 * ```ts
 * declare module '@open-mercato/shared/lib/i18n/config' {
 *   interface LocaleRegistry { cs: true }
 * }
 * ```
 *
 * Unaugmented, `Locale` resolves to exactly `'en' | 'pl' | 'es' | 'de' | 'ko'`,
 * so existing exhaustive `Record<Locale, T>` maps keep their drift-guard value —
 * and an app that opts in keeps exhaustiveness over its own extended set. This
 * is the same `keyof SomeRegistry` + declaration-merging idiom TypeScript uses
 * on itself (`NumberFormatOptionsStyleRegistry` in `lib.es5.d.ts`, additively
 * merged with `unit` in `lib.es2020.intl.d.ts`).
 *
 * The type layer is advisory only: declaration merging applies when a package is
 * *installed*, not when it is *enabled*, so it can claim a locale the running app
 * never registered. `getSupportedLocales()` in `./locale-registry` is the single
 * runtime authority, and every entry point validates against it.
 */
export interface LocaleRegistry {
  en: true
  pl: true
  es: true
  de: true
  ko: true
}

export type Locale = keyof LocaleRegistry & string

// NOTE: `scripts/dev.mjs` reads the next two declarations by regex (it parses
// this file as text to build the dev splash screen before the app compiles).
// Keep them as literal `export const <name>: <Type> = <literal>` statements.
export const locales: Locale[] = ['en', 'pl', 'es', 'de', 'ko']
export const defaultLocale: Locale = 'en'
