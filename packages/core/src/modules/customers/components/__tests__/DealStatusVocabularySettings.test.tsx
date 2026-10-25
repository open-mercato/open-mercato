/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import dictionary from '../../i18n/en.json'
import { DealStatusVocabularySettings } from '../DealStatusVocabularySettings'

const version = '2026-10-18T09:00:00.000Z'
const readMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const scopedHeadersMock = jest.fn((_headers: Record<string, string>, operation: () => Promise<unknown>) => operation())
const initialValuesMock = jest.fn()
const formErrorsMock = jest.fn()
const conflictMock = jest.fn()
const flashMock = jest.fn()
const refetchMock = jest.fn()
let hookState = {
  vocabulary: { won: ['win', 'won'], lost: ['lost', 'loose'], closed: ['closed'] },
  source: 'tenant', updatedAt: version, isLoading: false, isError: false, refetch: refetchMock,
}

jest.mock('../hooks/useDealStatusVocabulary', () => ({ useDealStatusVocabulary: () => hookState }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readMock(...args),
  withScopedApiRequestHeaders: (...args: Parameters<typeof scopedHeadersMock>) => scopedHeadersMock(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: (...args: Parameters<typeof runMutationMock>) => runMutationMock(...args), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: (...args: unknown[]) => conflictMock(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues, fields, onSubmit, extraActions, submitLabel }: CrudFormProps<Record<string, unknown>>) => {
    const [values, setValues] = React.useState(initialValues ?? {})
    const [error, setError] = React.useState<string | null>(null)
    initialValuesMock(initialValues)
    return (
      <div>
        {fields.map((field) => (
          <div key={field.id}>
            <span>{field.label}</span>
            {field.type === 'custom' ? React.createElement(field.component, {
              id: field.id,
              value: values[field.id],
              setValue: (value: unknown) => setValues((current) => ({ ...current, [field.id]: value })),
            }) : <input value={String(values[field.id] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} />}
          </div>
        ))}
        <button type="button" onClick={() => { void Promise.resolve(onSubmit?.(values)).catch((caught: unknown) => (formErrorsMock(caught), setError(caught instanceof Error ? caught.message : String(caught)))) }}>{submitLabel}</button>
        {extraActions}
        {error ? <div role="alert">{error}</div> : null}
      </div>
    )
  },
}))

describe('deal status vocabulary editor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    hookState = {
      vocabulary: { won: ['win', 'won'], lost: ['lost', 'loose'], closed: ['closed'] },
      source: 'tenant', updatedAt: version, isLoading: false, isError: false, refetch: refetchMock,
    }
    readMock.mockResolvedValue({})
    conflictMock.mockReturnValue(false)
  })

  function renderEditor() {
    const queryClient = new QueryClient()
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
    const view = renderWithProviders(<DealStatusVocabularySettings />, { dict: dictionary, queryClient })
    return { ...view, invalidate }
  }

  it('submits validated comma-separated values and supplies CrudForm the loaded version', async () => {
    const { invalidate } = renderEditor()
    expect(initialValuesMock).toHaveBeenCalledWith(expect.objectContaining({ won: 'win, won', updatedAt: version }))
    expect(screen.getByRole('textbox', { name: 'Won statuses' })).toHaveAttribute('name', 'won')
    expect(screen.getByRole('textbox', { name: 'Lost statuses' })).toHaveAttribute('name', 'lost')
    expect(screen.getByRole('textbox', { name: 'Closed statuses' })).toHaveAttribute('name', 'closed')
    fireEvent.change(screen.getByRole('textbox', { name: 'Won statuses' }), { target: { value: 'signed, contract, ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Lost statuses' }), { target: { value: 'rejected' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Closed statuses' }), { target: { value: 'archived' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('/api/customers/settings/deal-status-vocabulary', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ vocabulary: { won: ['signed', 'contract'], lost: ['rejected'], closed: ['archived'] } }),
    }), expect.any(Object)))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] })
  })

  it('rejects aliases assigned to conflicting groups without making a write', async () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Won statuses'), { target: { value: 'lost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    await screen.findByText(dictionary['customers.settings.dealStatusVocabulary.validationError'])
    expect(readMock).not.toHaveBeenCalled()
    expect(formErrorsMock).toHaveBeenCalledWith(expect.objectContaining({
      fieldErrors: expect.objectContaining({ won: dictionary['customers.settings.dealStatusVocabulary.validationError'] }),
    }))
  })

  it('resets through mutation guards with the loaded optimistic-lock version', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(readMock).toHaveBeenCalledWith('/api/customers/settings/deal-status-vocabulary', expect.objectContaining({ body: JSON.stringify({ vocabulary: null }) }), expect.any(Object)))
    expect(runMutationMock).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'customers.deal_status_vocabulary', retryLastMutation: expect.any(Function) }),
      mutationPayload: { vocabulary: null },
    }))
    expect(scopedHeadersMock).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': version }, expect.any(Function))
  })

  it('shows loading and recoverable errors before rendering editable values', async () => {
    hookState.isLoading = true
    const view = renderEditor()
    expect(screen.getByText('Loading deal status vocabulary…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Won statuses')).not.toBeInTheDocument()
    hookState = { ...hookState, isLoading: false, isError: true }
    view.rerender(<DealStatusVocabularySettings />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load deal status vocabulary.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces reset conflicts through the persistent conflict UI', async () => {
    const conflict = new Error('Concurrent edit')
    readMock.mockRejectedValueOnce(conflict)
    conflictMock.mockReturnValueOnce(true)
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(conflictMock).toHaveBeenCalledWith(conflict, expect.any(Function)))
    expect(flashMock).not.toHaveBeenCalled()
  })
})
