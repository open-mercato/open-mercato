// Fixture: proves an app that opts in KEEPS its exhaustiveness guarantee — a
// `Record<Locale, …>` that forgets the app's own locale must still fail to
// compile. Expected to produce a diagnostic; see `locale-augmentation.test.ts`.
import type { Locale } from '../../config'

declare module '../../config' {
  interface LocaleRegistry {
    cs: true
  }
}

export const labels: Record<Locale, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  de: 'Deutsch',
  ko: '한국어',
}
