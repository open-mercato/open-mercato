// Fixture: what a downstream application writes to serve a language the
// platform does not ship. Compiled by `locale-augmentation.test.ts`, never by
// the package typecheck (tsconfig excludes `__tests__`), because the
// augmentation would otherwise widen `Locale` for the whole package.
import type { Locale } from '../../config'

declare module '../../config' {
  interface LocaleRegistry {
    cs: true
  }
}

// The new code is now a valid Locale — no patching of node_modules required.
export const appAddedLocale: Locale = 'cs'

// The shipped ones still are.
export const shippedLocale: Locale = 'pl'

// And exhaustiveness is preserved over the app's OWN extended set: this map
// compiles only because it covers all six.
export const labels: Record<Locale, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  de: 'Deutsch',
  ko: '한국어',
  cs: 'čeština',
}
