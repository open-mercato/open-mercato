import { htmlToMarkdown, normalizeMarkdownText } from '../lib/markdown'

describe('akeneo markdown conversion', () => {
  it('converts rich html to markdown', () => {
    expect(htmlToMarkdown('<p>Hello <strong>world</strong><br><a href="https://example.com">Link</a></p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Hello **world**\n[Link](https://example.com)\n\n- One\n- Two',
    )
  })

  it('passes plain text through', () => {
    expect(normalizeMarkdownText('Simple text')).toBe('Simple text')
  })
})
