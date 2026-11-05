/**
 * @jest-environment node
 */
import { hydrateNotesSettings, DEFAULT_SETTINGS as NOTES_DEFAULTS } from '../notes/config'
import {
  hydrateWelcomeSettings,
  resolveWelcomeText,
  WELCOME_HEADLINE_KEY,
  WELCOME_MESSAGE_KEY,
  DEFAULT_SETTINGS as WELCOME_DEFAULTS,
} from '../welcome/config'
import { hydrateTodoSettings, DEFAULT_SETTINGS as TODO_DEFAULTS } from '../todos/config'

describe('example dashboard widget configs', () => {
  it('hydrates welcome settings with defaults and interpolation tokens intact', () => {
    expect(hydrateWelcomeSettings(undefined)).toEqual(WELCOME_DEFAULTS)
    expect(
      hydrateWelcomeSettings({ headline: 'Hello', message: 'World' })
    ).toEqual({ headline: 'Hello', message: 'World' })
    expect(
      hydrateWelcomeSettings({ headline: '   ' })
    ).toEqual(WELCOME_DEFAULTS)
  })

  describe('resolveWelcomeText', () => {
    const translate = (key: string, fallback: string) =>
      ({
        [WELCOME_HEADLINE_KEY]: 'Witaj ponownie, {{user}}!',
        [WELCOME_MESSAGE_KEY]: 'Korzystaj z tego pulpitu.',
      })[key] ?? fallback

    it('translates the shipped English default that was persisted into an existing layout', () => {
      expect(resolveWelcomeText(WELCOME_DEFAULTS.headline, WELCOME_DEFAULTS.headline, WELCOME_HEADLINE_KEY, translate))
        .toBe('Witaj ponownie, {{user}}!')
      expect(resolveWelcomeText(WELCOME_DEFAULTS.message!, WELCOME_DEFAULTS.message!, WELCOME_MESSAGE_KEY, translate))
        .toBe('Korzystaj z tego pulpitu.')
    })

    it('leaves user-authored text untouched', () => {
      expect(resolveWelcomeText('Moje własne powitanie', WELCOME_DEFAULTS.headline, WELCOME_HEADLINE_KEY, translate))
        .toBe('Moje własne powitanie')
    })

    it('keeps a deliberately cleared message empty instead of restoring the default', () => {
      expect(resolveWelcomeText('', WELCOME_DEFAULTS.message!, WELCOME_MESSAGE_KEY, translate)).toBe('')
    })

    it('falls back to the English default when the locale has no translation', () => {
      const noTranslations = (_key: string, fallback: string) => fallback
      expect(resolveWelcomeText(WELCOME_DEFAULTS.headline, WELCOME_DEFAULTS.headline, WELCOME_HEADLINE_KEY, noTranslations))
        .toBe(WELCOME_DEFAULTS.headline)
    })
  })

  it('hydrates notes settings and coalesces falsy values', () => {
    expect(hydrateNotesSettings(null)).toEqual(NOTES_DEFAULTS)
    expect(hydrateNotesSettings({ text: 'My note' })).toEqual({ text: 'My note' })
    expect(hydrateNotesSettings({ text: 42 as any })).toEqual(NOTES_DEFAULTS)
  })

  it('hydrates todo settings, applying bounds to page size', () => {
    expect(hydrateTodoSettings(undefined)).toEqual(TODO_DEFAULTS)
    expect(
      hydrateTodoSettings({ pageSize: 10, showCompleted: false })
    ).toEqual({ pageSize: 10, showCompleted: false })
    expect(
      hydrateTodoSettings({ pageSize: 0 })
    ).toEqual({ pageSize: TODO_DEFAULTS.pageSize, showCompleted: true })
    expect(
      hydrateTodoSettings({ pageSize: 99, showCompleted: undefined as any })
    ).toEqual({ pageSize: TODO_DEFAULTS.pageSize, showCompleted: true })
  })
})
