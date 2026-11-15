// Compile-time-only guard for the shape of `Locale`. Never imported at runtime:
// `yarn typecheck` (`tsc --noEmit`) is the only gate that can catch a regression
// here, because this repo's Jest transform runs with `isolatedModules: true` and
// therefore skips type diagnostics.
//
// It sits outside `__tests__` because `packages/shared/tsconfig.json` excludes
// that directory from `tsc --noEmit`, and it is a `.tsx` rather than a `.ts`
// because the mutation gate mutates changed `src/lib/**/*.ts` files and runs only
// their related Jest tests. See the identical reasoning in `context.typecheck.tsx`.
//
// What it protects: `Locale` is derived from `LocaleRegistry` so downstream apps
// can widen it by declaration merging. That indirection must not accidentally
// degrade it to `string`, which would silently delete every exhaustiveness check
// the platform and its apps rely on.
import type { Locale, LocaleRegistry } from './config'

// 1. Unaugmented, `Locale` is still the exact five-member union.
type Expected = 'en' | 'pl' | 'es' | 'de' | 'ko'
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const localeUnionIsUnchanged: MutuallyAssignable<Locale, Expected> = true

// 2. It has NOT collapsed to `string` — that would make the union check above
//    pass vacuously in one direction and destroy exhaustiveness everywhere.
const localeIsNotWidenedToString: MutuallyAssignable<Locale, string> = false

// 3. Every shipped code is assignable.
const shipped: Locale[] = ['en', 'pl', 'es', 'de', 'ko']

// 4. A code nobody registered is still rejected.
// @ts-expect-error 'cs' is not a member of Locale until an app augments LocaleRegistry
const unregistered: Locale = 'cs'

// 5. Exhaustive `Record<Locale, T>` still works as a drift guard: omitting a
//    member must remain an error, which is what apps depend on today.
const exhaustiveLabels: Record<Locale, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  de: 'Deutsch',
  ko: '한국어',
}

// @ts-expect-error a Record<Locale, …> missing `ko` must stay an error
const nonExhaustiveLabels: Record<Locale, string> = {
  en: 'English',
  pl: 'Polski',
  es: 'Español',
  de: 'Deutsch',
}

// 6. The registry keys and the union stay in lockstep.
const registryKeysMatchLocale: MutuallyAssignable<keyof LocaleRegistry & string, Locale> = true

void localeUnionIsUnchanged
void localeIsNotWidenedToString
void shipped
void unregistered
void exhaustiveLabels
void nonExhaustiveLabels
void registryKeysMatchLocale
