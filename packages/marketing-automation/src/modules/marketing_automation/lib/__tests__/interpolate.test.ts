import { interpolate } from '../interpolate'

describe('interpolate', () => {
  const values = {
    customer: { displayName: 'Ada', email: 'ada@example.com' },
    trigger: { orderTotal: 120.5, orderNumber: 'SO-1001' },
    nothing: null,
    nested: { deep: { value: 7 } },
  }

  test('substitutes a top-level and a nested path', () => {
    expect(interpolate('Hi {{customer.displayName}}', values)).toBe('Hi Ada')
    expect(interpolate('{{nested.deep.value}}', values)).toBe('7')
  })

  test('tolerates whitespace inside the braces', () => {
    expect(interpolate('Hi {{  customer.displayName  }}', values)).toBe('Hi Ada')
  })

  test('substitutes numbers as text', () => {
    expect(interpolate('Total {{trigger.orderTotal}}', values)).toBe('Total 120.5')
  })

  test('handles several placeholders in one string', () => {
    expect(interpolate('{{trigger.orderNumber}} for {{customer.displayName}}', values))
      .toBe('SO-1001 for Ada')
  })

  // An unresolved placeholder stays visible rather than collapsing to an empty string: a typo
  // that produces "Hi {{customer.nmae}}" gets noticed and fixed, while "Hi " does not.
  test('leaves an unresolved placeholder verbatim', () => {
    expect(interpolate('Hi {{customer.nmae}}', values)).toBe('Hi {{customer.nmae}}')
    expect(interpolate('{{nothing}}', values)).toBe('{{nothing}}')
    expect(interpolate('{{missing.deep.path}}', values)).toBe('{{missing.deep.path}}')
  })

  test('does not stringify an object into the message', () => {
    expect(interpolate('{{customer}}', values)).toBe('{{customer}}')
  })

  test('leaves text without placeholders untouched', () => {
    expect(interpolate('No placeholders here.', values)).toBe('No placeholders here.')
  })

  test('walking through a non-object stops rather than throwing', () => {
    expect(interpolate('{{customer.displayName.deeper}}', values)).toBe('{{customer.displayName.deeper}}')
  })
})

describe('interpolate — HTML sink', () => {
  // The firing test: a customer-controlled value carrying markup must not survive as markup in an
  // email body. Without the escape this substitution produced a live anchor sent from the tenant's
  // own verified domain.
  const hostile = {
    customer: { displayName: 'Ada<a href="https://attacker.example">Verify now</a>' },
  }

  test('escapes markup when filling an HTML body', () => {
    const rendered = interpolate('Hello {{customer.displayName}}', hostile, 'html')
    expect(rendered).not.toContain('<a href')
    expect(rendered).toContain('&lt;a href=&quot;https://attacker.example&quot;&gt;')
  })

  test.each([['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']])(
    'escapes %p in an HTML sink',
    (raw, escaped) => {
      expect(interpolate('{{v}}', { v: raw }, 'html')).toBe(escaped)
    },
  )

  // Subjects and plain-text bodies are not HTML, so escaping them would corrupt legitimate copy.
  test('leaves a text sink verbatim', () => {
    expect(interpolate('{{v}}', { v: 'Tom & Jerry' })).toBe('Tom & Jerry')
    expect(interpolate('{{v}}', { v: 'Tom & Jerry' }, 'text')).toBe('Tom & Jerry')
  })

  test('the placeholder itself is never escaped away when unresolved', () => {
    expect(interpolate('{{missing}}', {}, 'html')).toBe('{{missing}}')
  })
})
