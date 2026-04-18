import { sanitizeHtmlRichText, sanitizeRichTextHref, sanitizeRichTextPasteContent } from '../richTextSanitizer'

describe('richTextSanitizer', () => {
  it('keeps basic rich text tags and safe links', () => {
    expect(
      sanitizeHtmlRichText('<p>Hello <strong>world</strong> <a href="https://example.com" title="Example">link</a></p>'),
    ).toBe('<p>Hello <strong>world</strong> <a href="https://example.com" title="Example">link</a></p>')
  })

  it('removes executable content and unsafe attributes', () => {
    expect(
      sanitizeHtmlRichText('<p onclick="alert(1)" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(2)>there</p>'),
    ).toBe('<p>Hithere</p>')
  })

  it('removes unsafe href values from links', () => {
    expect(
      sanitizeHtmlRichText('<a href="java\nscript:alert(1)" target="_blank" rel="opener">Bad link</a>'),
    ).toBe('<a>Bad link</a>')
  })

  it('unwraps unknown formatting tags without keeping their attributes', () => {
    expect(sanitizeHtmlRichText('<custom-element data-x="1"><b>Safe</b></custom-element>')).toBe('<b>Safe</b>')
  })

  it('normalizes href values by allowlist', () => {
    expect(sanitizeRichTextHref(' https://example.com/docs ')).toBe('https://example.com/docs')
    expect(sanitizeRichTextHref('https://example.com/docs?a=1&b=2')).toBe('https://example.com/docs?a=1&b=2')
    expect(sanitizeRichTextHref('/backend/customers')).toBe('/backend/customers')
    expect(sanitizeRichTextHref('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(sanitizeRichTextHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeRichTextHref('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('sanitizes plain text paste when it contains html markup', () => {
    expect(
      sanitizeRichTextPasteContent(
        '',
        '<p>Safe text</p><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">Bad link</a>',
      ),
    ).toEqual({
      command: 'insertHTML',
      value: '<p>Safe text</p><a>Bad link</a>',
    })
  })

  it('keeps non-html plain text paste as text', () => {
    expect(sanitizeRichTextPasteContent('', 'Plain < not a tag')).toEqual({
      command: 'insertText',
      value: 'Plain < not a tag',
    })
  })
})
