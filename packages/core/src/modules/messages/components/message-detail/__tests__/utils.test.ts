import { isSafeNavigationHref } from '../utils'

describe('isSafeNavigationHref', () => {
  it.each([
    '/backend/messages/1',
    './relative',
    '../up',
    'https://example.com/orders/1',
    'http://example.com/orders/1',
    'mailto:support@example.com',
    'tel:+123456789',
  ])('allows safe href %s', (href) => {
    expect(isSafeNavigationHref(href)).toBe(true)
  })

  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example.com/steal',
    '',
    '   ',
  ])('blocks unsafe href %s', (href) => {
    expect(isSafeNavigationHref(href)).toBe(false)
  })
})
