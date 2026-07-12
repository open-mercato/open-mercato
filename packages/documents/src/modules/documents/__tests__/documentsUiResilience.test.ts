import fs from 'node:fs'
import path from 'node:path'

const documentsRoot = path.resolve(__dirname, '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(documentsRoot, relativePath), 'utf8')
}

describe('Documents UI resilience states', () => {
  it.each([
    'backend/documents/DocumentsPageClient.tsx',
    'backend/documents/templates/TemplatesPageClient.tsx',
    'backend/documents/[id]/DocumentPageClient.tsx',
    'backend/documents/[id]/VersionHistoryPanel.tsx',
  ])('%s provides a visible dynamic loading fallback', (relativePath) => {
    const source = read(relativePath)
    expect(source).not.toContain('loading: () => null')
    expect(source).toMatch(/loading:\s*[A-Z][A-Za-z]+Loading/)
    expect(source).toContain('<LoadingMessage')
    expect(source).toContain('role="status"')
  })

  it.each([
    ['backend/documents/DocumentsPageClient.tsx', 'documents.loadError', 'documents.refresh'],
    ['backend/documents/templates/TemplatesPageClient.tsx', 'templates.loadError', 'templates.refresh'],
  ])('%s renders a recoverable list error', (relativePath, errorState, retryAction) => {
    const source = read(relativePath)
    expect(source).toContain(errorState)
    expect(source).toContain('<ErrorMessage')
    expect(source).toContain(`onClick={${retryAction}}`)
  })
})
