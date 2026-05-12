import {
  sanitizeRichTextHref,
  sanitizeRichTextHtml,
  sanitizeRichTextPasteContent,
} from '../sanitizeRichText'

describe('sanitizeRichText', () => {
  it('keeps basic rich text tags and safe links', () => {
    expect(
      sanitizeRichTextHtml('<p>Hello <strong>world</strong> <a href="https://example.com" title="Example">link</a></p>'),
    ).toBe('<p>Hello <strong>world</strong> <a href="https://example.com" title="Example">link</a></p>')
  })

  it('removes executable content and unsafe attributes', () => {
    // `<img>` is on the allowlist (toolbar `insertImage`), so the tag stays
    // but the `onerror` handler is stripped and the `color:red` keyword
    // doesn't match the hex/rgb allowed-style regex so it falls away too.
    expect(
      sanitizeRichTextHtml('<p onclick="alert(1)" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(2)>there</p>'),
    ).toBe('<p>Hi<img src="x" />there</p>')
  })

  it('removes unsafe href values from links', () => {
    expect(
      sanitizeRichTextHtml('<a href="java\nscript:alert(1)" target="_blank" rel="opener">Bad link</a>'),
    ).toBe('<a>Bad link</a>')
  })

  it('unwraps unknown formatting tags without keeping their attributes', () => {
    expect(sanitizeRichTextHtml('<custom-element data-x="1"><b>Safe</b></custom-element>')).toBe('<b>Safe</b>')
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
      value: '<p>Safe text</p><img src="x" /><a>Bad link</a>',
    })
  })

  it('keeps RichEditor toolbar output: hr / image / table / inline-code / code-block / checklist', () => {
    expect(sanitizeRichTextHtml('<hr />')).toBe('<hr />')
    expect(sanitizeRichTextHtml('<img src="https://example.com/x.png" alt="" />')).toBe('<img src="https://example.com/x.png" alt="" />')
    expect(sanitizeRichTextHtml('<table><tbody><tr><td>a</td></tr></tbody></table>')).toBe('<table><tbody><tr><td>a</td></tr></tbody></table>')
    expect(sanitizeRichTextHtml('<p>before <code>inline</code> after</p>')).toBe('<p>before <code>inline</code> after</p>')
    expect(sanitizeRichTextHtml('<pre>code block</pre>')).toBe('<pre>code block</pre>')
    expect(sanitizeRichTextHtml('<ul data-task-list="true"><li><label><input type="checkbox" /> task</label></li></ul>')).toBe(
      '<ul data-task-list="true"><li><label><input type="checkbox" /> task</label></li></ul>',
    )
  })

  it('keeps color + font-size span styles emitted by the toolbar color picker / font size dropdown', () => {
    expect(sanitizeRichTextHtml('<span style="color:#6366f1">blue</span>')).toBe('<span style="color:#6366f1">blue</span>')
    expect(sanitizeRichTextHtml('<span style="font-size:16px">big</span>')).toBe('<span style="font-size:16px">big</span>')
    // Disallowed style values (CSS keyword colors, url(), etc.) still get dropped.
    expect(sanitizeRichTextHtml('<span style="color:red">red</span>')).toBe('<span>red</span>')
    expect(sanitizeRichTextHtml('<span style="background-image:url(http://evil)">x</span>')).toBe('<span>x</span>')
  })

  it('only allows <input type="checkbox"> — other input types are dropped', () => {
    expect(sanitizeRichTextHtml('<input type="checkbox" checked />')).toBe('<input type="checkbox" checked />')
    expect(sanitizeRichTextHtml('<input type="text" value="x" />')).toBe('')
    expect(sanitizeRichTextHtml('<input type="file" />')).toBe('')
  })

  it('keeps non-html plain text paste as text', () => {
    expect(sanitizeRichTextPasteContent('', 'Plain < not a tag')).toEqual({
      command: 'insertText',
      value: 'Plain < not a tag',
    })
  })
})
