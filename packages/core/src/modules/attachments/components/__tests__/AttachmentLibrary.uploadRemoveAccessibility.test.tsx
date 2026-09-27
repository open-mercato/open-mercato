/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AttachmentLibrary } from '../AttachmentLibrary'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, values?: Record<string, string>) =>
    (fallback ?? key).replace('{{name}}', values?.name ?? ''),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/backend/storage/attachments',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  AttachmentDeleteDialog: () => null,
  AttachmentMetadataDialog: () => null,
}))

const apiCallMock = jest.fn(async (url: string) => {
  if (url === '/api/auth/feature-check') {
    return { ok: true, result: { granted: ['attachments.manage'] } }
  }
  return {
    ok: true,
    result: {
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
      availableTags: [],
      partitions: [],
    },
  }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...(args as [string])),
}))

describe('AttachmentLibrary upload accessibility', () => {
  test('identifies each selected file remove button', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AttachmentLibrary />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull())
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['invoice'], 'invoice.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('button', { name: 'Remove invoice.pdf' })).toHaveAttribute(
      'title',
      'Remove invoice.pdf',
    )
  })
})
