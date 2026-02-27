/**
 * @jest-environment node
 */
import { hydrateNotesSettings, DEFAULT_SETTINGS as NOTES_DEFAULTS } from '../notes/config'
import { hydrateWelcomeSettings, DEFAULT_SETTINGS as WELCOME_DEFAULTS } from '../welcome/config'
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
