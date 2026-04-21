import { markdownToPlainText } from '../markdownToPlainText'

describe('markdownToPlainText', () => {
  it('returns empty string for nullish input', () => {
    expect(markdownToPlainText(null)).toBe('')
    expect(markdownToPlainText(undefined)).toBe('')
    expect(markdownToPlainText('')).toBe('')
  })

  it('strips headings, lists, and emphasis', () => {
    const input = '# Heading\n\n- **bold** *italic* item\n- another _em_ item'
    expect(markdownToPlainText(input)).toBe('Heading bold italic item another em item')
  })

  it('strips code fences and inline code', () => {
    const input = 'prefix `inline` text\n```\ncode block\n```\nsuffix'
    expect(markdownToPlainText(input)).toBe('prefix inline text suffix')
  })

  it('collapses links and drops images', () => {
    const input = 'visit [link text](https://example.com) and ![alt](https://img.example/x.png) here'
    expect(markdownToPlainText(input)).toBe('visit link text and here')
  })

  it('flattens blockquotes, strikethrough, and table pipes', () => {
    const input = '> quoted text\n\n~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    expect(markdownToPlainText(input)).toBe('quoted text gone a b - - 1 2')
  })
})
