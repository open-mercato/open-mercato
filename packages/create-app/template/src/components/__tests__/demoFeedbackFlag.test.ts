/**
 * @jest-environment jsdom
 */

import { HIDE_CONTACT_FLAG_KEY, isContactWidgetHidden } from '../demoFeedbackFlag'

describe('isContactWidgetHidden', () => {
  afterEach(() => {
    window.localStorage.clear()
    jest.restoreAllMocks()
  })

  it('is false when the flag is absent', () => {
    expect(isContactWidgetHidden()).toBe(false)
  })

  it('is true when the flag is present with an empty value', () => {
    window.localStorage.setItem(HIDE_CONTACT_FLAG_KEY, '')
    expect(isContactWidgetHidden()).toBe(true)
  })

  it.each(['1', 'true', 'yes', 'on', 'whatever'])('is true for value %s', (value) => {
    window.localStorage.setItem(HIDE_CONTACT_FLAG_KEY, value)
    expect(isContactWidgetHidden()).toBe(true)
  })

  it.each(['0', 'false', 'off', 'no'])('is false for explicit opt-out value %s', (value) => {
    window.localStorage.setItem(HIDE_CONTACT_FLAG_KEY, value)
    expect(isContactWidgetHidden()).toBe(false)
  })

  it('is false when localStorage access throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(isContactWidgetHidden()).toBe(false)
  })
})
