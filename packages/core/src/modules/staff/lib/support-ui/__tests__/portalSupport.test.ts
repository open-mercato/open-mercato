import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatFileSize, isPortalSupportAccountNotLinked } from '../portalSupport'

const translate: TranslateFn = (key, fallbackOrParams, params) => {
  const template = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const values = (typeof fallbackOrParams === 'object' ? fallbackOrParams : params) ?? {}
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}

describe('formatFileSize', () => {
  it('formats sizes through the translated unit keys', () => {
    expect(formatFileSize(translate, 0)).toBe('0 B')
    expect(formatFileSize(translate, 512)).toBe('512 B')
    expect(formatFileSize(translate, 2048)).toBe('2.0 KB')
    expect(formatFileSize(translate, 3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('asks for the unit-specific translation key', () => {
    const keys: string[] = []
    const recording: TranslateFn = (key, fallbackOrParams, params) => {
      keys.push(key)
      return translate(key, fallbackOrParams, params)
    }
    formatFileSize(recording, 10)
    formatFileSize(recording, 10 * 1024)
    formatFileSize(recording, 10 * 1024 * 1024)
    expect(keys).toEqual([
      'staff.portal.support.fileSize.bytes',
      'staff.portal.support.fileSize.kilobytes',
      'staff.portal.support.fileSize.megabytes',
    ])
  })
})

describe('isPortalSupportAccountNotLinked', () => {
  it('recognises the not-linked refusal by its code', () => {
    expect(isPortalSupportAccountNotLinked({
      status: 403,
      result: { ok: false, error: 'staff.errors.customerAccountNotLinked', code: 'customer_account_not_linked' },
    })).toBe(true)
  })

  it('leaves other refusals and failures to the generic error state', () => {
    expect(isPortalSupportAccountNotLinked({ status: 403, result: { ok: false, error: 'staff.errors.forbidden' } })).toBe(false)
    expect(isPortalSupportAccountNotLinked({ status: 500, result: { code: 'customer_account_not_linked' } })).toBe(false)
    expect(isPortalSupportAccountNotLinked({ status: 403, result: null })).toBe(false)
  })
})
