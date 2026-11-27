import { stripNulCharacters } from '../extractedText'

describe('stripNulCharacters', () => {
  it('removes every U+0000', () => {
    expect(stripNulCharacters('\u0000A\u0000\u0000B\u0000')).toBe('AB')
  })

  it('leaves other control characters, whitespace and non-ASCII text untouched', () => {
    const text = ' \u0001\u0008\t\r\n\u007fzażółć 日本語 \u{1F600} '
    expect(stripNulCharacters(text)).toBe(text)
  })

  it('returns an empty string when the text is only U+0000', () => {
    expect(stripNulCharacters('\u0000\u0000')).toBe('')
  })
})
