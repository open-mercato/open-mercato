/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ProposalBuilderDialog, normalizeProposalQuantity } from '../ProposalBuilderDialog'

/**
 * #8268 QA S12b: under `pl` the author types `1,5` — the builder sent it verbatim and the route's
 * decimal-string schema refused it with a generic 400. The quantity is now read in the author's
 * locale and sent as a canonical decimal; a value that is not a number above zero is flagged on
 * the field instead of reaching the server.
 */

const mockWrite = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => (
    <div role="dialog" onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/icon-button', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: async () => ({ ok: true, result: { items: [] } }),
  readApiResultOrThrow: (url: string, init?: RequestInit) => mockWrite(url, init),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'

function renderDialog(locale: string) {
  const onOpenChange = jest.fn()
  const onSuccess = jest.fn()
  renderWithProviders(
    <ProposalBuilderDialog open onOpenChange={onOpenChange} threadId="thread-1" onSuccess={onSuccess} />,
    { locale },
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Product' }), { target: { value: PRODUCT_ID } })
  return { onOpenChange, onSuccess }
}

function sentQuantities(): string[] {
  return mockWrite.mock.calls.flatMap(([, init]) =>
    (JSON.parse(String(init?.body)) as { lines: Array<{ quantity: string }> }).lines.map((line) => line.quantity),
  )
}

describe('normalizeProposalQuantity', () => {
  test.each([
    ['1,5', 'pl', '1.5'],
    ['1.5', 'pl', '1.5'],
    ['2', 'en', '2'],
    ['1 234,5', 'pl', '1234.5'],
    [' 3 ', 'en', '3'],
  ])('reads %p under %p as %p', (input, locale, expected) => {
    expect(normalizeProposalQuantity(input, locale)).toBe(expected)
  })

  test.each([['0'], ['-1'], ['abc'], [''], ['0,0000001']])('refuses %p', (input) => {
    expect(normalizeProposalQuantity(input, 'pl')).toBeNull()
  })
})

describe('ProposalBuilderDialog quantity handling (#8268 QA S12b)', () => {
  beforeEach(() => {
    mockWrite.mockReset()
    mockFlash.mockReset()
    mockWrite.mockResolvedValue({ proposalId: 'proposal-1', rejectedLines: [] })
  })

  test('a Polish decimal comma is sent as a canonical decimal', async () => {
    const { onSuccess } = renderDialog('pl')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Author proposal' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(sentQuantities()).toEqual(['1.5'])
  })

  test('a quantity that is not a number above zero is flagged on the field and never sent', async () => {
    renderDialog('pl')
    const quantity = screen.getByLabelText('Quantity')
    fireEvent.change(quantity, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Author proposal' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a quantity greater than zero.')
    expect(quantity).toHaveAttribute('aria-invalid', 'true')
    expect(mockFlash).toHaveBeenCalledWith('Enter a quantity greater than zero.', 'error')
    expect(mockWrite).not.toHaveBeenCalled()

    fireEvent.change(quantity, { target: { value: '2' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(quantity).not.toHaveAttribute('aria-invalid')
  })

  test('two Ctrl+Enter presses submit the proposal once', async () => {
    let finish: (value: unknown) => void = () => undefined
    mockWrite.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const { onSuccess } = renderDialog('en')
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    expect(mockWrite).toHaveBeenCalledTimes(1)

    finish({ proposalId: 'proposal-1', rejectedLines: [] })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(mockWrite).toHaveBeenCalledTimes(1)
  })
})
