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
const CONNECT_TRIGGER_KEY = 'communication_channels.profile.connect.menu'

// The connect area is an open injection spot (extension-points.ts → profileConnect),
// so any channel-* package can add a control there. Copy that enumerates the
// providers goes stale the moment a new one is injected (#4981).
const PROVIDER_NAMES = ['Gmail', 'IMAP', 'Discord', 'SMTP']

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

  // Since #5595 the connect control is hub-owned: ConnectChannelMenu renders one
  // fixed trigger whatever is installed, so naming *a* control no longer goes
  // stale. Repeating that trigger's translated label inside the empty state does:
  // it copies one string into a second key, and the two drift apart as soon as
  // either is reworded in a single locale. The empty state points at the trigger
  // by position instead, and this guard reads the label from the locale rather
  // than hard-coding it so it cannot itself go stale when the trigger is renamed.
  it('does not duplicate the connect trigger label inside the empty state', () => {
    for (const [locale, dict] of Object.entries(locales)) {
      const triggerLabel = dict[CONNECT_TRIGGER_KEY]
      // Without this the guard would silently pass on a locale that never
      // translated the trigger, which is the one case it needs to catch.
      expect({ locale, triggerLabel }).toEqual({ locale, triggerLabel: expect.stringMatching(/\S/) })
      expect(`${locale}:${dict[EMPTY_KEY]}`).not.toContain(triggerLabel)
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
