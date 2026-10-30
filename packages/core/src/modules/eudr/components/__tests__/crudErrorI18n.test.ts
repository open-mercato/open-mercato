import { translateEudrErrorMessage } from '../crudErrorI18n'

const messages: Record<string, string> = {
  'eudr.errors.archivedReadOnly': 'Archived statements are read-only.',
}

const translate = (key: string) => messages[key] ?? key

const fallback = 'Could not delete the statement.'

describe('translateEudrErrorMessage', () => {
  it('surfaces the reason carried on the rejection error property', () => {
    const err = Object.assign(new Error('[internal] eudr statement delete failed'), {
      status: 400,
      error: 'eudr.errors.archivedReadOnly',
    })

    expect(translateEudrErrorMessage(err, translate, fallback)).toBe('Archived statements are read-only.')
  })

  it('surfaces the reason carried on the rejection message', () => {
    const err = new Error('eudr.errors.archivedReadOnly')

    expect(translateEudrErrorMessage(err, translate, fallback)).toBe('Archived statements are read-only.')
  })

  it('falls back for rejections that carry no eudr error token', () => {
    expect(translateEudrErrorMessage(new Error('Failed to fetch'), translate, fallback)).toBe(fallback)
    expect(translateEudrErrorMessage({ status: 500 }, translate, fallback)).toBe(fallback)
    expect(translateEudrErrorMessage(null, translate, fallback)).toBe(fallback)
  })

  it('falls back when the token has no translation rather than showing the raw key', () => {
    const err = Object.assign(new Error('boom'), { error: 'eudr.errors.notMappedAnywhere' })

    expect(translateEudrErrorMessage(err, translate, fallback)).toBe(fallback)
  })
})
