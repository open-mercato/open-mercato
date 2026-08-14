import { renderToStaticMarkup } from 'react-dom/server'
import { Preview } from '../Preview'

describe('Preview', () => {
  it('uses an iframe for Blob-backed PDFs', () => {
    const markup = renderToStaticMarkup(
      <Preview
        url="blob:http://localhost/document-preview"
        title="Document preview"
      />,
    )

    expect(markup).toContain('<iframe')
    expect(markup).toContain('src="blob:http://localhost/document-preview"')
    expect(markup).not.toContain('sandbox=')
    expect(markup).not.toContain('<object')
  })
})
