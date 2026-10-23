import {
  assertSafeNotificationHref,
  isSafeNotificationHref,
  sanitizeNotificationActions,
  toSafeNotificationHref,
} from '../safeHref'
import { safeRelativeHrefSchema } from '../../data/validators'

const ACCEPTED = [
  '/backend/notifications',
  '/backend/sales/orders/{sourceEntityId}',
  '/backend/catalog/products?tab=prices#variants',
  '/%5Cnot-a-host',
  '/backend/\u3000search',
  '/',
]

const REJECTED = [
  'https://evil.example/path',
  '//evil.example/path',
  '/\\evil.example/path',
  '/\\/evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  '/backend/\u0000x',
  '/..//evil.example',
  '/.//evil.example',
  '/%2e%2e//evil.example',
  'javascript:alert(1)',
  'backend/relative',
  '',
]

describe('isSafeNotificationHref', () => {
  it.each(ACCEPTED)('accepts same-origin path %j', (href) => {
    expect(isSafeNotificationHref(href)).toBe(true)
  })

  it.each(REJECTED)('rejects %j', (href) => {
    expect(isSafeNotificationHref(href)).toBe(false)
  })
})

describe('toSafeNotificationHref', () => {
  it('returns null for null and undefined', () => {
    expect(toSafeNotificationHref(null)).toBeNull()
    expect(toSafeNotificationHref(undefined)).toBeNull()
  })

  it('returns a safe href unchanged', () => {
    expect(toSafeNotificationHref('/backend/notifications')).toBe('/backend/notifications')
  })

  it('returns null for a slash-backslash host', () => {
    expect(toSafeNotificationHref('/\\evil.example')).toBeNull()
  })
})

describe('assertSafeNotificationHref', () => {
  it('passes through null and safe values', () => {
    expect(assertSafeNotificationHref(null)).toBeUndefined()
    expect(assertSafeNotificationHref('/backend/x')).toBe('/backend/x')
  })

  it('throws for a slash-backslash host', () => {
    expect(() => assertSafeNotificationHref('/\\evil.example')).toThrow()
  })
})

describe('sanitizeNotificationActions', () => {
  it('throws when an action href resolves to another origin', () => {
    expect(() =>
      sanitizeNotificationActions([{ id: 'open', label: 'Open', href: '/\t/evil.example' }]),
    ).toThrow()
  })
})

describe('safeRelativeHrefSchema', () => {
  it('rejects a slash-backslash host', () => {
    expect(safeRelativeHrefSchema.safeParse('/\\evil.example/p').success).toBe(false)
  })

  it('accepts a normal backend path', () => {
    expect(safeRelativeHrefSchema.safeParse('/backend/notifications').success).toBe(true)
  })
})
