/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReturnDialog } from '../ReturnDialog'

const mockFlash = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockRunMutation = jest.fn()
const mockHandleSectionMutationError = jest.fn()

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: any[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: any[]) => mockApiCallOrThrow(...args),
  withScopedApiRequestHeaders: (_headers: any, run: () => any) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: (...args: any[]) => mockRunMutation(...args) }),
}))

jest.mock('../optimisticLock', () => ({
  handleSectionMutationError: (...args: any[]) => mockHandleSectionMutationError(...args),
}))

jest.mock('@open-mercato/core/modules/sales/lib/returnQuantity', () => ({
  computeAvailableReturnQuantity: (line: any) => line.quantity - (line.returnedQuantity ?? 0),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/counter-input', () => ({
  CounterInput: ({ id, value, onChange }: any) => (
    <input
      data-testid={id}
      type="number"
      value={value ?? ''}
      onChange={(event) => {
        const raw = event.target.value
        onChange?.(raw === '' ? null : Number(raw))
      }}
    />
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>
      {children}
    </button>
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const SERVER_MESSAGE =
  'Cannot return more than the shipped quantity. Ship the items before recording a return.'
const GENERIC_FALLBACK = 'Failed to create return.'

const baseLines = [
  { id: 'line-1', title: 'Widget', lineNumber: 1, quantity: 5, returnedQuantity: 0 },
]

function renderDialog() {
  return render(
    <ReturnDialog
      open
      orderId="order-1"
      lines={baseLines}
      documentUpdatedAt={null}
      onClose={jest.fn()}
      onSaved={jest.fn().mockResolvedValue(undefined)}
    />,
  )
}

function enterQuantityAndSubmit() {
  fireEvent.change(screen.getByTestId('return-qty-line-1'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: /create return/i }))
}

describe('ReturnDialog error surfacing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHandleSectionMutationError.mockReturnValue(false)
    mockRunMutation.mockImplementation(async (config: any) => config.operation())
  })

  it('surfaces the server error reason instead of the generic fallback', async () => {
    mockApiCallOrThrow.mockRejectedValue(
      Object.assign(new Error(SERVER_MESSAGE), { error: SERVER_MESSAGE, status: 400 }),
    )

    renderDialog()
    enterQuantityAndSubmit()

    await waitFor(() => expect(mockFlash).toHaveBeenCalled())
    expect(mockFlash).toHaveBeenCalledWith(SERVER_MESSAGE, 'error')
    expect(mockFlash).not.toHaveBeenCalledWith(GENERIC_FALLBACK, 'error')
  })

  it('falls back to the generic message when the server provides no reason', async () => {
    mockApiCallOrThrow.mockRejectedValue(new Error(''))

    renderDialog()
    enterQuantityAndSubmit()

    await waitFor(() => expect(mockFlash).toHaveBeenCalled())
    expect(mockFlash).toHaveBeenCalledWith(GENERIC_FALLBACK, 'error')
  })

  it('defers to the optimistic-lock handler without flashing a create error', async () => {
    mockHandleSectionMutationError.mockReturnValue(true)
    mockApiCallOrThrow.mockRejectedValue(
      Object.assign(new Error('conflict'), { status: 409 }),
    )

    renderDialog()
    enterQuantityAndSubmit()

    await waitFor(() => expect(mockHandleSectionMutationError).toHaveBeenCalled())
    expect(mockFlash).not.toHaveBeenCalledWith(SERVER_MESSAGE, 'error')
    expect(mockFlash).not.toHaveBeenCalledWith(GENERIC_FALLBACK, 'error')
  })
})
