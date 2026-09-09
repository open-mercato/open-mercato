import fs from 'node:fs'
import path from 'node:path'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'
import ko from '../i18n/ko.json'

const locales: Record<string, Record<string, string>> = { en, es, pl, de, ko }

const SUBTITLE_KEY = 'communication_channels.profile.subtitle'
const EMPTY_KEY = 'communication_channels.profile.empty'

const PROVIDER_NAMES = ['Gmail', 'IMAP', 'Discord', 'SMTP']

// The connect area is an open injection spot (extension-points.ts → profileConnect),
// so any channel-* package can add a button. Copy that names a fixed control or a
// fixed provider set goes stale the moment a new provider is injected (#4981).
const NONEXISTENT_CONTROL_LITERALS: Record<string, string[]> = {
  en: ['Connect channel'],
  es: ['Conectar canal'],
  pl: ['Połącz kanał'],
  de: ['Kanal verbinden'],
  ko: ['채널 연결'],
}

const EMAIL_ONLY_LITERALS: Record<string, string[]> = {
  en: ['mailbox'],
  es: ['buzón'],
  pl: ['skrzynkę pocztową'],
  de: ['Postfach'],
  ko: ['메일함'],
}

const pageSource = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'profile', 'communication-channels', 'page.tsx'),
  'utf8',
)

describe('communication channels profile copy i18n (#4981)', () => {
  it('never enumerates connectable providers in the intro or the empty state', () => {
    for (const [locale, dict] of Object.entries(locales)) {
      for (const key of [SUBTITLE_KEY, EMPTY_KEY]) {
        for (const provider of PROVIDER_NAMES) {
          expect(`${locale}:${key}:${dict[key]}`).not.toMatch(new RegExp(provider, 'i'))
        }
      }
    }
  })

  it('does not point the empty state at a "Connect channel" control that no provider renders', () => {
    for (const [locale, dict] of Object.entries(locales)) {
      for (const literal of NONEXISTENT_CONTROL_LITERALS[locale]) {
        expect(`${locale}:${dict[EMPTY_KEY]}`).not.toContain(literal)
      }
    }
  })

  it('does not scope the intro to an email mailbox', () => {
    for (const [locale, dict] of Object.entries(locales)) {
      for (const literal of EMAIL_ONLY_LITERALS[locale]) {
        expect(`${locale}:${dict[SUBTITLE_KEY]}`).not.toContain(literal)
      }
    }
  })

  it('keeps the page inline fallbacks byte-identical to the English locale', () => {
    for (const key of [SUBTITLE_KEY, EMPTY_KEY]) {
      expect(pageSource).toContain(`'${key}',`)
      expect(pageSource).toContain(en[key as keyof typeof en] as string)
    }
  })
})
