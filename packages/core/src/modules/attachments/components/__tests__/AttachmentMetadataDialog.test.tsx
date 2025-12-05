/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AttachmentMetadataDialog } from '../AttachmentLibrary'

const previewSpy = jest.fn()

jest.mock('../AttachmentContentPreview', () => ({
  AttachmentContentPreview: (props: any) => {
    previewSpy(props)
    return <div data-testid="preview-proxy">{props.content ?? 'no-content'}</div>
  },
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => <div data-testid="crud-form" />,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockApiCall = jest.requireMock('@open-mercato/ui/backend/utils/apiCall').apiCall as jest.Mock

const baseItem = {
  id: 'att-1',
  fileName: 'file.pdf',
  fileSize: 10,
  mimeType: 'application/pdf',
  partitionCode: 'privateAttachments',
  partitionTitle: 'Private',
  url: '/api/attachments/file/att-1',
  createdAt: new Date().toISOString(),
  tags: [],
  assignments: [],
}

describe('AttachmentMetadataDialog content preview', () => {
  beforeEach(() => {
    previewSpy.mockReset()
    mockApiCall.mockReset()
  })

  it('renders extracted content when available', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { item: { id: 'att-1', tags: [], assignments: [], content: 'extracted text' } },
    })
    render(
      <AttachmentMetadataDialog
        open
        onOpenChange={() => {}}
        item={baseItem}
        availableTags={[]}
        onSave={async () => {}}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('preview-proxy')).toBeInTheDocument())
    expect(previewSpy).toHaveBeenCalledWith(expect.objectContaining({ content: 'extracted text' }))
  })

  it('shows placeholder when no content is returned', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { item: { id: 'att-1', tags: [], assignments: [], content: null } },
    })
    render(
      <AttachmentMetadataDialog
        open
        onOpenChange={() => {}}
        item={baseItem}
        availableTags={[]}
        onSave={async () => {}}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('preview-proxy')).toBeInTheDocument())
    expect(previewSpy).toHaveBeenCalledWith(expect.objectContaining({ content: null }))
    expect(screen.getByText(/no-content/)).toBeInTheDocument()
  })
})
