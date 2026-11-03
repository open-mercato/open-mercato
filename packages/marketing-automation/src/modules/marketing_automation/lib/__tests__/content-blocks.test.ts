import {
  applyContentBlocks,
  isValidBlockKey,
  referencedBlockKeys,
} from '../content-blocks'

describe('block keys', () => {
  test.each(['footer', 'seasonal-banner', 'logo_header', 'b2b2024'])('%s is a valid key', (key) => {
    expect(isValidBlockKey(key)).toBe(true)
  })

  // The key appears inside `{{block:…}}`, so anything that could close or nest that syntax is refused.
  test.each(['Footer', 'foo bar', 'foo}}', '{{foo', 'foo:bar', '', '-leading', 'a'.repeat(65)])(
    '%s is refused',
    (key) => {
      expect(isValidBlockKey(key)).toBe(false)
    },
  )
})

describe('referencedBlockKeys', () => {
  test('finds each distinct reference once', () => {
    expect(referencedBlockKeys('<p>{{block:footer}}</p><div>{{block:footer}}{{block:header}}</div>'))
      .toEqual(['footer', 'header'])
  })

  test('tolerates whitespace and case in the reference', () => {
    expect(referencedBlockKeys('{{ block:Footer }}')).toEqual(['footer'])
  })

  test('finds nothing in a body with no references', () => {
    expect(referencedBlockKeys('<p>Hello {{customer.displayName}}</p>')).toEqual([])
  })
})

describe('applyContentBlocks', () => {
  test('inserts the block HTML raw, because a block is author content', () => {
    expect(applyContentBlocks('<p>{{block:footer}}</p>', { footer: '<a href="https://x.test">Shop</a>' }))
      .toBe('<p><a href="https://x.test">Shop</a></p>')
  })

  test('replaces every occurrence', () => {
    expect(applyContentBlocks('{{block:hr}}{{block:hr}}', { hr: '<hr>' })).toBe('<hr><hr>')
  })

  /**
   * A missing block leaves nothing, not its own name.
   *
   * An author who deletes a block should not find out by seeing `{{block:footer}}` printed in a customer's
   * inbox — the literal text is the one outcome worse than an empty space.
   */
  test('a reference to a block that does not exist disappears', () => {
    expect(applyContentBlocks('<p>a{{block:gone}}b</p>', {})).toBe('<p>ab</p>')
  })

  test('matches case-insensitively against lowercase keys', () => {
    expect(applyContentBlocks('{{block:Footer}}', { footer: '<b>f</b>' })).toBe('<b>f</b>')
  })

  // One level is enough for footers and headers; recursion buys a cycle to guard for no asked-for use.
  test('does not resolve a block referenced from inside another block', () => {
    expect(applyContentBlocks('{{block:outer}}', { outer: 'x{{block:inner}}y', inner: 'NESTED' }))
      .toBe('x{{block:inner}}y')
  })

  test('leaves ordinary interpolation alone', () => {
    expect(applyContentBlocks('{{customer.displayName}}{{block:f}}', { f: '!' }))
      .toBe('{{customer.displayName}}!')
  })
})
