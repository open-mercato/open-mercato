import {
  isCancelShortcut,
  isSubmitShortcut,
  resolveDownloadLabelKey,
  resolvePreviewKind,
  resolvePreviewTitleKey,
} from '../preview-state'

describe('preview-state', () => {
  it('distinguishes Markdown from PDF formats', () => {
    expect(resolvePreviewKind('markdown')).toBe('markdown')
    expect(resolvePreviewKind('MD')).toBe('markdown')
    expect(resolvePreviewKind('pdf')).toBe('pdf')
    expect(resolveDownloadLabelKey('markdown')).toBe('document_generators.generate.buttonMarkdown')
    expect(resolveDownloadLabelKey('pdf')).toBe('document_generators.generate.button')
    expect(resolvePreviewTitleKey('markdown')).toBe('document_generators.preview.markdownTitle')
    expect(resolvePreviewTitleKey('pdf')).toBe('document_generators.preview.pdfTitle')
  })

  it('recognises Cmd/Ctrl+Enter and Escape only', () => {
    expect(isSubmitShortcut({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isSubmitShortcut({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isSubmitShortcut({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false)
    expect(isSubmitShortcut({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false)
    expect(isCancelShortcut({ key: 'Escape' })).toBe(true)
    expect(isCancelShortcut({ key: 'Enter' })).toBe(false)
  })
})
