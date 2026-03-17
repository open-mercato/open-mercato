"use client"
import { useId, useState } from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'

export function LanguageSwitcher() {
  const current = useLocale()
  const t = useT()
  const [pending, setPending] = useState(false)
  const selectId = useId()

  const languageLabels: Record<Locale, string> = {
    en: t('common.languages.english', 'English'),
    pl: t('common.languages.polish', 'Polski'),
    es: t('common.languages.spanish', 'Español'),
    de: t('common.languages.german', 'Deutsch'),
  }

  async function setLocale(locale: Locale) {
    if (locale === current) return
    if (typeof window === 'undefined') return
    setPending(true)
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    const redirectUrl = new URL('/api/auth/locale', window.location.origin)
    redirectUrl.searchParams.set('locale', locale)
    redirectUrl.searchParams.set('redirect', currentUrl)
    window.location.assign(redirectUrl.toString())
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <label htmlFor={selectId}>{t('common.language')}</label>
      <div className="relative">
        <select
          id={selectId}
          className="appearance-none rounded-md border bg-background px-3 py-1 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-60"
          value={current}
          onChange={(event) => setLocale(event.target.value as Locale)}
          disabled={pending}
        >
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {languageLabels[locale]}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </div>
    </div>
  )
}
