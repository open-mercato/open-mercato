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
    'widgets/injection/related-documents/widget.client.tsx',
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

  it.each([
    ['backend/documents/components/NewFromTemplateDialog.tsx', 'flow.retryTemplates'],
    ['backend/documents/components/TemplateEditorDialog.tsx', 'templateDetail.retry'],
    ['backend/documents/[id]/RecordFieldsDialog.tsx', 'onClick={retry}'],
    ['backend/documents/[id]/CommentsRail.tsx', 'comments.reload()'],
    ['backend/documents/[id]/DocumentPageClient.tsx', 'loadDocument()'],
    ['backend/documents/components/ShareDialogList.tsx', 'onClick={onRetry}'],
    ['backend/documents/[id]/VersionHistoryPanel.tsx', 'reload()'],
    ['backend/documents/[id]/VersionPreviewDialog.tsx', 'setLoadAttempt'],
  ])('%s exposes a retry action for asynchronous load failures', (relativePath, retryAction) => {
    const source = read(relativePath)
    expect(source).toContain('<ErrorMessage')
    expect(source).toContain('documents.actions.retry')
    expect(source).toContain(retryAction)
  })

  it.each([
    'backend/documents/DocumentsPageClient.tsx',
    'backend/documents/[id]/DocumentPageClient.tsx',
    'backend/documents/templates/TemplatesPageClient.tsx',
    'widgets/injection/related-documents/widget.client.tsx',
  ])('%s keeps TipTap and editor runtime code out of its shell bundle', (relativePath) => {
    const source = read(relativePath)
    expect(source).not.toMatch(/^import\s+(?!type\b)[^\n]+from ['"]@tiptap\//m)
  })

  // Structural on purpose: scripts/check-documents-bundle-budgets.mjs relies on the
  // literal import specifier to attribute the island's chunk, so the import shape
  // itself is the contract. Rendered behavior lives in documentsUiResilience.render.test.tsx.
  it('uses a literal dynamic import for the document editor island', () => {
    const source = read('backend/documents/[id]/DocumentPageClient.tsx')
    expect(source).toContain("dynamic(() => import('./DocumentEditorIsland')")
    expect(source).not.toMatch(/^import\s+DocumentEditorIsland\s+from/m)
  })

  it.each([
    ['backend/documents/DocumentsPageClient.tsx', 'NewFromTemplateDialogLoading'],
    ['backend/documents/[id]/DocumentPageClient.tsx', 'DocumentEditorLoading'],
    ['backend/documents/[id]/VersionHistoryPanel.tsx', 'VersionPreviewDialogLoading'],
    ['backend/documents/templates/TemplatesPageClient.tsx', 'TemplateEditorDialogLoading'],
    ['widgets/injection/related-documents/widget.client.tsx', 'NewFromTemplateDialogLoading'],
  ])('%s exposes Next dynamic import failures through a retryable loading boundary', (relativePath, boundaryName) => {
    const source = read(relativePath)
    expect(source).toContain(`function ${boundaryName}({ error, retry }`)
    expect(source).toMatch(/if \(error\)|\{error \? \(/)
    expect(source).toContain('onClick={retry}')
    expect(source).toContain('documents.actions.retry')
  })
})
