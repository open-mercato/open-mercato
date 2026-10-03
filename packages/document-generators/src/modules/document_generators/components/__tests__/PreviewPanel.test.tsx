/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PreviewPanel } from '../PreviewPanel'
import { requestDocument } from '../document-request'
import { downloadBlob } from '../../utils'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))
jest.mock('../document-request', () => ({ requestDocument: jest.fn() }))
jest.mock('../../utils', () => ({ downloadBlob: jest.fn() }))

const requestMock = requestDocument as jest.Mock
const downloadMock = downloadBlob as jest.Mock

const baseTemplate = {
  id: 'sales.order.invoice',
  label: 'Invoice',
  description: '',
  module: 'sales',
  resourceKind: 'order',
  documentType: 'invoice',
  tags: [],
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    requestMock.mockReset()
    downloadMock.mockReset()
    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:preview'), revokeObjectURL: jest.fn() })
    requestMock.mockImplementation(async ({ action }: { action: string }) => ({
      blob: Object.assign(new Blob(['# Hello'], { type: action === 'preview' ? 'text/markdown' : 'application/pdf' }), {
        text: async () => '# Hello',
      }),
      filename: 'doc.pdf',
    }))
  })

  it('shows Markdown as text and does not call onGenerated after preview', async () => {
    const onGenerated = jest.fn()
    render(<PreviewPanel template={{ ...baseTemplate, format: 'markdown' }} record={{ id: 'r1' }} onClose={jest.fn()} onGenerated={onGenerated} />)
    await waitFor(() => expect(screen.getByText('# Hello')).toBeTruthy())
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock.mock.calls[0][0].action).toBe('preview')
    expect(onGenerated).not.toHaveBeenCalled()
    expect(screen.getByText('document_generators.generate.buttonMarkdown')).toBeTruthy()
  })

  it('renders a PDF iframe and revokes the object URL on unmount', async () => {
    const view = render(<PreviewPanel template={{ ...baseTemplate, format: 'pdf' }} record={{ id: 'r1' }} onClose={jest.fn()} />)
    await waitFor(() => expect(screen.getByTitle('document_generators.preview.pdfTitle')).toBeTruthy())
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('downloads and calls onGenerated only after a successful generate', async () => {
    const onGenerated = jest.fn()
    render(<PreviewPanel template={{ ...baseTemplate, format: 'pdf' }} record={{ id: 'r1' }} onClose={jest.fn()} onGenerated={onGenerated} />)
    await waitFor(() => expect(screen.getByTitle('document_generators.preview.pdfTitle')).toBeTruthy())
    fireEvent.click(screen.getByText('document_generators.generate.button'))
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1))
    expect(downloadMock).toHaveBeenCalledTimes(1)
  })

  it('does not call onGenerated when generation fails', async () => {
    const onGenerated = jest.fn()
    requestMock.mockImplementation(async ({ action }: { action: string }) => {
      if (action === 'generate') throw new Error('boom')
      return { blob: new Blob(['x'], { type: 'application/pdf' }), filename: 'doc.pdf' }
    })
    render(<PreviewPanel template={{ ...baseTemplate, format: 'pdf' }} record={{ id: 'r1' }} onClose={jest.fn()} onGenerated={onGenerated} />)
    await waitFor(() => expect(screen.getByTitle('document_generators.preview.pdfTitle')).toBeTruthy())
    fireEvent.click(screen.getByText('document_generators.generate.button'))
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
    expect(onGenerated).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('generates on Cmd+Enter', async () => {
    const onGenerated = jest.fn()
    render(<PreviewPanel template={{ ...baseTemplate, format: 'pdf' }} record={{ id: 'r1' }} onClose={jest.fn()} onGenerated={onGenerated} />)
    await waitFor(() => expect(screen.getByTitle('document_generators.preview.pdfTitle')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1))
  })
})
