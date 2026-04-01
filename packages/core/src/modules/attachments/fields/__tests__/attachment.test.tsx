/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, type ApiCallResult } from '@open-mercato/ui/backend/utils/apiCall'
import { AttachmentInput } from '../attachment'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

function buildApiCallResult<TReturn>(result: TReturn | null, ok = true): ApiCallResult<TReturn> {
  return {
    ok,
    status: ok ? 200 : 400,
    result,
    response: {} as Response,
    cacheStatus: null,
  }
}

function renderWithI18n(node: ReactNode) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      {node}
    </I18nProvider>,
  )
}

describe('AttachmentInput', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('shows a save-first notice until the record exists', () => {
    renderWithI18n(<AttachmentInput entityId="example:todo" def={{ key: 'attachments' }} />)

    expect(screen.getByText(/save the record before uploading files/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /choose files/i })).not.toBeInTheDocument()
  })

  it('renders a visible upload CTA and includes the field key in uploads', async () => {
    apiCallMock
      .mockResolvedValueOnce(buildApiCallResult({ items: [] }))
      .mockResolvedValueOnce(buildApiCallResult({ ok: true }))
      .mockResolvedValueOnce(buildApiCallResult({
        items: [
          {
            id: 'att-1',
            url: '/api/attachments/file/att-1',
            fileName: 'todo.pdf',
            fileSize: 128,
          },
        ],
      }))

    const { container } = renderWithI18n(
      <AttachmentInput
        entityId="example:todo"
        recordId="todo-1"
        def={{ key: 'attachments', acceptExtensions: ['pdf'] }}
      />,
    )

    expect(await screen.findByRole('button', { name: /choose files/i })).toBeInTheDocument()

    const input = container.querySelector('input[type="file"]')
    expect(input).toBeInstanceOf(HTMLInputElement)

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'todo.pdf', { type: 'application/pdf' })],
      },
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(3))

    const uploadCall = apiCallMock.mock.calls[1]
    expect(uploadCall?.[0]).toBe('/api/attachments')
    expect(uploadCall?.[1]).toMatchObject({ method: 'POST' })

    const formData = uploadCall?.[1]?.body
    expect(formData).toBeInstanceOf(FormData)
    expect((formData as FormData).get('entityId')).toBe('example:todo')
    expect((formData as FormData).get('recordId')).toBe('todo-1')
    expect((formData as FormData).get('fieldKey')).toBe('attachments')

    expect(await screen.findByText('todo.pdf')).toBeInTheDocument()
  })
})
