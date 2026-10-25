/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import dictionary from '../../i18n/en.json'
import { DealStatusVocabularySettings } from '../DealStatusVocabularySettings'

let mockScopeVersion = 0
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScopeVersion }))

const version = '2026-10-18T09:00:00.000Z'
const readMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const scopedHeadersMock = jest.fn((_headers: Record<string, string>, operation: () => Promise<unknown>) => operation())
const initialValuesMock = jest.fn()
const formErrorsMock = jest.fn()
const formSavedMock = jest.fn()
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
        <button type="button" onClick={() => { void Promise.resolve(onSubmit?.(values)).then(formSavedMock).catch((caught: unknown) => (formErrorsMock(caught), setError(caught instanceof Error ? caught.message : String(caught)))) }}>{submitLabel}</button>
        {extraActions}
        {error ? <div role="alert">{error}</div> : null}
      </div>
    )
  },
}))

describe('deal status vocabulary editor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockScopeVersion = 0
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

  function reclassificationError(affectedDeals = 2, token = 'a') {
    return Object.assign(new Error('Confirmation required'), {
      status: 409, code: 'deal_status_reclassification_confirmation_required',
      impact: { affectedDeals, fingerprint: token.repeat(64) },
    })
  }

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  })

  it('shows affected count, supports Escape cancel and leaves the setting untouched', async () => {
    readMock.mockRejectedValueOnce(reclassificationError())
    const { invalidate } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Existing deals affected: 2')
    expect(readMock).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(invalidate).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalled()
    await waitFor(() => expect(formErrorsMock).toHaveBeenCalledWith(expect.objectContaining({ message: dictionary['customers.settings.dealStatusVocabulary.saveInterrupted'] })))
    expect(formSavedMock).not.toHaveBeenCalled()
  })

  it('cancels reset without completing mutation guards or flashing an error', async () => {
    readMock.mockRejectedValueOnce(reclassificationError())
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(readMock).toHaveBeenCalledTimes(1)
    await expect(runMutationMock.mock.results[0].value).rejects.toMatchObject({ message: dictionary['customers.settings.dealStatusVocabulary.saveInterrupted'] })
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('does not complete form success when scope changes during query invalidation', async () => {
    const view = renderEditor()
    let finishInvalidation: () => void = () => undefined
    view.invalidate.mockImplementationOnce(() => new Promise<void>((resolve) => { finishInvalidation = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    await waitFor(() => expect(view.invalidate).toHaveBeenCalled())
    mockScopeVersion += 1
    view.rerender(<DealStatusVocabularySettings />)
    finishInvalidation()
    await waitFor(() => expect(formErrorsMock).toHaveBeenCalled())
    expect(formSavedMock).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('confirms the same candidate with fingerprint and version through Ctrl+Enter', async () => {
    readMock.mockRejectedValueOnce(reclassificationError())
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    await screen.findByRole('alertdialog')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Apply vocabulary change' }), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(readMock.mock.calls[1][1].body)).toEqual({
      vocabulary: hookState.vocabulary, reclassificationConfirmation: { fingerprint: 'a'.repeat(64) },
    })
    expect(scopedHeadersMock).toHaveBeenLastCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': version }, expect.any(Function))
    await waitFor(() => expect(flashMock).toHaveBeenCalledTimes(1))
  })

  it('requires a refreshed explicit confirmation when reset impact changes', async () => {
    readMock.mockRejectedValueOnce(reclassificationError(2, 'a')).mockRejectedValueOnce(reclassificationError(3, 'b'))
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Existing deals affected: 2')
    fireEvent.click(screen.getByRole('button', { name: 'Apply vocabulary change' }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('Existing deals affected: 3'))
    expect(readMock).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Apply vocabulary change' }))
    await waitFor(() => expect(readMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(readMock.mock.calls[2][1].body)).toEqual({ vocabulary: null, reclassificationConfirmation: { fingerprint: 'b'.repeat(64) } })
  })

  it.each(['scope', 'version', 'candidate'])('discards pending confirmation when %s changes', async (change) => {
    readMock.mockRejectedValueOnce(reclassificationError())
    const view = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save vocabulary' }))
    await screen.findByRole('alertdialog')
    if (change === 'scope') mockScopeVersion += 1
    if (change === 'version') hookState = { ...hookState, updatedAt: '2026-10-25T12:00:00.000Z' }
    if (change === 'candidate') fireEvent.change(screen.getByLabelText('Won statuses'), { target: { value: 'changed' } })
    else view.rerender(<DealStatusVocabularySettings />)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(formSavedMock).not.toHaveBeenCalled()
  })

})
