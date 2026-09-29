import { htmlToPlainText } from '../htmlToPlainText'

describe('htmlToPlainText', () => {
  it('returns an empty string for empty input without invoking the parser', () => {
    expect(htmlToPlainText('')).toBe('')
  })

  it('renders block-level markup as readable prose', () => {
    const html = '<html><body><p>Hello,</p><p>second paragraph.</p></body></html>'

    const text = htmlToPlainText(html)

    expect(text).toContain('Hello,')
    expect(text).toContain('second paragraph.')
    expect(text).not.toContain('<p>')
    expect(text).not.toContain('</body>')
  })

  it('drops script and style content instead of inlining it as text', () => {
    // Email HTML routinely carries a <style> block and a tracking <script>.
    // Rendering either as text is what made ingested bodies unreadable.
    const html = [
      '<!DOCTYPE html><html><head>',
      '<style>body { margin: 0; font-family: Helvetica; }</style>',
      '<script>trackOpen("beacon")</script>',
      '</head><body><p>Visible copy</p></body></html>',
    ].join('')

    const text = htmlToPlainText(html)

    expect(text).toBe('Visible copy')
    expect(text).not.toContain('font-family')
    expect(text).not.toContain('trackOpen')
    expect(text).not.toContain('<!DOCTYPE')
  })

  it('normalizes CRLF and lone CR line endings to LF', () => {
    const text = htmlToPlainText('<pre>first\r\nsecond\rthird</pre>')

    expect(text).not.toContain('\r')
    expect(text).toBe('first\nsecond\nthird')
  })

  it('collapses runs of three or more blank lines down to one', () => {
    const text = htmlToPlainText('<pre>top\n\n\n\n\nbottom</pre>')

    expect(text).toBe('top\n\nbottom')
  })

  it('preserves a single blank line between paragraphs', () => {
    const text = htmlToPlainText('<pre>top\n\nbottom</pre>')

    expect(text).toBe('top\n\nbottom')
  })

  it('trims surrounding whitespace', () => {
    expect(htmlToPlainText('<pre>\n\n  padded  \n\n</pre>')).toBe('padded')
  })
})
