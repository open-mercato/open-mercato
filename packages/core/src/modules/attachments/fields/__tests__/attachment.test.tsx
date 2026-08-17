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
const mockConfirm = jest.fn()

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

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
    mockConfirm.mockReset()
    mockConfirm.mockResolvedValue(true)
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

  it('does not reload when the host replaces the count callback', async () => {
    apiCallMock.mockResolvedValue(buildApiCallResult({ items: [] }))

    const firstCallback = jest.fn()
    const secondCallback = jest.fn()
    const dict = {}
    const view = render(
      <I18nProvider locale="en" dict={dict}>
        <AttachmentInput entityId="example:todo" recordId="todo-1" onCountChange={firstCallback} />
      </I18nProvider>,
    )

    await waitFor(() => expect(firstCallback).toHaveBeenCalledWith(0))
    view.rerender(
      <I18nProvider locale="en" dict={dict}>
        <AttachmentInput entityId="example:todo" recordId="todo-1" onCountChange={secondCallback} />
      </I18nProvider>,
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(secondCallback).not.toHaveBeenCalled()
  })

  it('exposes opt-in replace and confirmed delete actions for persisted attachments', async () => {
    apiCallMock
      .mockResolvedValueOnce(buildApiCallResult({
        items: [{ id: 'att-1', url: '/files/original.pdf', fileName: 'original.pdf', fileSize: 128 }],
      }))
      .mockResolvedValueOnce(buildApiCallResult({ ok: true }))
      .mockResolvedValueOnce(buildApiCallResult({ items: [] }))

    const view = renderWithI18n(
      <AttachmentInput
        entityId="warranty_claims:warranty_claim"
        recordId="claim-1"
        allowDelete
        allowReplace
      />,
    )

    expect(await screen.findByRole('button', { name: /replace/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /delete original\.pdf/i }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(3))
    expect(apiCallMock.mock.calls[1]?.[0]).toBe('/api/attachments?id=att-1')
    expect(apiCallMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(view.queryByText('original.pdf')).not.toBeInTheDocument()
  })

  it('uploads a replacement before deleting the previous attachment', async () => {
    apiCallMock
      .mockResolvedValueOnce(buildApiCallResult({
        items: [{ id: 'att-1', url: '/files/original.pdf', fileName: 'original.pdf', fileSize: 128 }],
      }))
      .mockResolvedValueOnce(buildApiCallResult({ ok: true }))
      .mockResolvedValueOnce(buildApiCallResult({ ok: true }))
      .mockResolvedValueOnce(buildApiCallResult({
        items: [{ id: 'att-2', url: '/files/replacement.pdf', fileName: 'replacement.pdf', fileSize: 256 }],
      }))

    renderWithI18n(
      <AttachmentInput
        entityId="warranty_claims:warranty_claim"
        recordId="claim-1"
        allowReplace
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /replace/i }))
    const replacementInput = screen.getByLabelText(/choose replacement file/i)
    fireEvent.change(replacementInput, {
      target: { files: [new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(4))
    expect(apiCallMock.mock.calls[1]?.[0]).toBe('/api/attachments')
    expect(apiCallMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(apiCallMock.mock.calls[2]?.[0]).toBe('/api/attachments?id=att-1')
    expect(apiCallMock.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' })
    expect(await screen.findByText('replacement.pdf')).toBeInTheDocument()
  })
})
