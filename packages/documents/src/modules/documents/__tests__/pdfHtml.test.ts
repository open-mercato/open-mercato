import { buildDocumentPdfHtml } from '../lib/pdfHtml'

describe('document PDF HTML', () => {
  it('renders an escaped visible title and inert A4 print shell', () => {
    const html = buildDocumentPdfHtml('Proposal <Acme> & "Partners"', '<p>Safe body</p>')

    expect(html).toContain('<title>Proposal &lt;Acme&gt; &amp; &quot;Partners&quot;</title>')
    expect(html).toContain('<h1 class="document-title">Proposal &lt;Acme&gt; &amp; &quot;Partners&quot;</h1>')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("script-src 'none'")
    expect(html).toContain('@page { size: A4; margin: 22mm 20mm; }')
    expect(html).not.toContain('<script')
  })

  it('includes print semantics for rich text, tables, images, and record chips', () => {
    const html = buildDocumentPdfHtml('Mixed document', '<table><thead><tr><th>Name</th></tr></thead></table>')

    expect(html).toContain('thead { display: table-header-group; }')
    expect(html).toContain('tr { break-inside: avoid-page; }')
    expect(html).toContain('ul:has(input[type="checkbox"])')
    expect(html).toContain('strong > code:only-child > span:only-child')
    expect(html).toContain('img { display: block; max-width: 100%;')
    expect(html).toContain('<main class="document-content"><table>')
  })
})
