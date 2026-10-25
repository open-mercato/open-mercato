/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordConflictBanner, dismissRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { TasksSection } from '../TasksSection'
import type { InteractionSummary } from '../types'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const flashMock = jest.fn()
const onDataRefreshMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: null }),
}))

jest.mock('../hooks/usePersonTasks', () => ({
  usePersonTasks: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => null,
  TabEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: function TestCrudForm({ initialValues, onSubmit, submitLabel }: {
    initialValues: Record<string, unknown>
    onSubmit: (values: Record<string, unknown>) => Promise<void>
    submitLabel: string
  }) {
    const [values, setValues] = React.useState(initialValues)
    const [error, setError] = React.useState<string | null>(null)
    return (
      <form onSubmit={(event) => {
        event.preventDefault()
        void onSubmit(values).catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : 'Failed to save')
        })
      }}>
        <label>
          Title
          <input value={String(values.title ?? '')} onChange={(event) => setValues({ ...values, title: event.target.value })} />
        </label>
        <label>
          Description
          <textarea value={String(values.description ?? '')} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </label>
        <button type="submit">{submitLabel}</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    )
  },
}))

const interaction: InteractionSummary = {
  id: 'interaction-1',
  entityId: 'customer-1',
  interactionType: 'task',
  title: 'Original task',
  body: 'Original description',
  status: 'planned',
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T11:00:00.000Z',
}

const conflict = Object.assign(new Error('Record modified'), {
  status: 409,
  body: {
    code: 'optimistic_lock_conflict',
    error: 'record_modified',
    expectedUpdatedAt: interaction.updatedAt,
    currentUpdatedAt: '2026-10-22T12:00:00.000Z',
  },
})

const taskActions: Array<[string, () => void]> = [
  ['complete', () => fireEvent.click(screen.getByRole('checkbox'))],
  ['cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))],
  ['delete', () => fireEvent.click(screen.getByRole('button', { name: 'Delete' }))],
]

async function renderTasks() {
  render(
    <>
      <RecordConflictBanner />
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        emptyLabel="No date"
        addActionLabel="Add task"
        emptyState={{ title: 'No tasks yet', actionLabel: 'Add task' }}
        useCanonicalInteractions
        onDataRefresh={onDataRefreshMock}
      />
    </>,
  )
  await screen.findByText('Original task')
}

describe('canonical task conflicts through the section and edit dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    dismissRecordConflict()
    readApiResultOrThrowMock.mockResolvedValue({ items: [interaction] })
    apiCallOrThrowMock.mockRejectedValue(conflict)
  })

  afterEach(() => act(() => dismissRecordConflict()))

  it('keeps rejected edit values and the dialog open while surfacing the conflict', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce({ items: [interaction] })
      .mockResolvedValue({
        items: [{ ...interaction, title: 'Changed in another tab', updatedAt: conflict.body.currentUpdatedAt }],
      })
    await renderTasks()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Attempted title' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Attempted description' } })

    fireEvent.click(screen.getByRole('button', { name: /Update task/ }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Record modified', 'error'))
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Attempted title')
    expect(screen.getByLabelText('Description')).toHaveValue('Attempted description')
    expect(screen.getByTestId('record-conflict-banner')).toBeInTheDocument()
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'success')
    expect(onDataRefreshMock).not.toHaveBeenCalled()
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/customers/interactions',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('Attempted title'),
      }),
      expect.anything(),
    )

    apiCallOrThrowMock.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: /Update task/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)
    expect(apiCallOrThrowMock).toHaveBeenLastCalledWith(
      '/api/customers/interactions',
      expect.objectContaining({
        body: expect.stringContaining('Attempted description'),
      }),
      expect.anything(),
    )
    expect(flashMock).toHaveBeenCalledWith('Task updated', 'success')
  })

  it.each(taskActions)('does not announce success for a rejected %s action', async (_name, activate) => {
    await renderTasks()
    activate()

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Record modified', 'error'))
    expect(screen.getByTestId('record-conflict-banner')).toBeInTheDocument()
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'success')
    expect(onDataRefreshMock).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('checkbox')).toBeEnabled()
  })

  it('closes the edit dialog and announces success after an accepted edit', async () => {
    apiCallOrThrowMock.mockResolvedValue(undefined)
    await renderTasks()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Accepted title' } })
    fireEvent.click(screen.getByRole('button', { name: /Update task/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(flashMock).toHaveBeenCalledWith('Task updated', 'success')
    expect(onDataRefreshMock).toHaveBeenCalledTimes(1)
  })
})
