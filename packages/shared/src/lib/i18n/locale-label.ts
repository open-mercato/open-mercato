import type { TranslateFn } from './context'
import { getIso639Label } from './iso639'

type ShippedLocaleLabel = {
  /** Dictionary key, so the label itself is localized when a translator is given. */
  key: string
  /** Endonym — the language's name in its own language. */
  native: string
}

// The locales the platform ships. Kept as literal data rather than derived from
// `Intl.DisplayNames` because `Intl` disagrees on casing for some of them
// (`español`, `polski`), and these strings are already user-visible.
const SHIPPED_LOCALE_LABELS: Record<string, ShippedLocaleLabel> = {
  en: { key: 'common.languages.english', native: 'English' },
  pl: { key: 'common.languages.polish', native: 'Polski' },
  es: { key: 'common.languages.spanish', native: 'Español' },
  de: { key: 'common.languages.german', native: 'Deutsch' },
  ko: { key: 'common.languages.korean', native: '한국어' },
}

// `resolveLocaleLabel` is called once per option per render of every language
// switcher, and constructing an `Intl.DisplayNames` is not free. The answer for
// a given code never changes within a process.
const intlDisplayNames = new Map<string, string | undefined>()

function resolveIntlDisplayName(locale: string): string | undefined {
  if (intlDisplayNames.has(locale)) return intlDisplayNames.get(locale)
  const resolved = computeIntlDisplayName(locale)
  intlDisplayNames.set(locale, resolved)
  return resolved
}

function computeIntlDisplayName(locale: string): string | undefined {
  try {
    // Ask for the language's name in its own language, so a switcher reads the
    // way a speaker of that language expects it to.
    const displayName = new Intl.DisplayNames([locale], { type: 'language' }).of(locale)
    // `Intl` echoes the input back when it has no data for the code.
    if (!displayName || displayName.toLowerCase() === locale.toLowerCase()) return undefined
    return displayName
  } catch {
    // Invalid or unsupported code — fall through to the ISO table.
    return undefined
  }
}

/**
 * A human-readable name for any locale code, including ones the platform does
 * not ship dictionaries for.
 *
 * Resolution order:
 *  1. the shipped table — via `t` when given, so the label is itself localized
 *     (a German UI shows "Polnisch"); otherwise the endonym ("Polski")
 *  2. `Intl.DisplayNames` — the endonym for an arbitrary code, no dependency
 *  3. the ISO 639-1 catalogue — the English name
 *  4. the uppercased code — never blank
 *
 * Pass `t` where the surrounding UI renders localized language names, and omit
 * it where it renders endonyms. Both conventions exist in the codebase and the
 * caller decides which one it wants.
 */
export function resolveLocaleLabel(locale: string, t?: TranslateFn): string {
  const shipped = SHIPPED_LOCALE_LABELS[locale]
  if (shipped) {
    return t ? t(shipped.key, shipped.native) : shipped.native
  }

  return resolveIntlDisplayName(locale) ?? getIso639Label(locale) ?? locale.toUpperCase()
}
