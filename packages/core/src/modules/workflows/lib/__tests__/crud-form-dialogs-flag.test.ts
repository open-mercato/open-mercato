import { resolveCrudFormDialogsEnabled } from '../crud-form-dialogs-flag'

describe('resolveCrudFormDialogsEnabled', () => {
  it('defaults to enabled when the flag is unset', () => {
    expect(resolveCrudFormDialogsEnabled(undefined)).toBe(true)
  })

  it('defaults to enabled for empty or unrecognized values', () => {
    expect(resolveCrudFormDialogsEnabled('')).toBe(true)
    expect(resolveCrudFormDialogsEnabled('maybe')).toBe(true)
  })

  it('stays enabled when explicitly turned on', () => {
    expect(resolveCrudFormDialogsEnabled('true')).toBe(true)
    expect(resolveCrudFormDialogsEnabled('1')).toBe(true)
  })

  it('restores the legacy dialogs when explicitly turned off', () => {
    expect(resolveCrudFormDialogsEnabled('false')).toBe(false)
    expect(resolveCrudFormDialogsEnabled('0')).toBe(false)
  })
})
