/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { RecordConflictBanner, dismissRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { TasksSection } from '../TasksSection'
import type { InteractionSummary } from '../types'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const withScopedApiRequestHeadersMock = jest.fn()
const flashMock = jest.fn()
const onDataRefreshMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => Promise<unknown>) => {
    withScopedApiRequestHeadersMock(headers)
    return operation()
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate, useLocale: () => 'en' }
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
    const editedFields = React.useRef(new Set<string>())

    React.useEffect(() => {
      setValues((current) => {
        let changed = false
        const next = { ...current }
        for (const [key, value] of Object.entries(initialValues)) {
          if (editedFields.current.has(key) || Object.is(next[key], value)) continue
          next[key] = value
          changed = true
        }
        return changed ? next : current
      })
    }, [initialValues])

    const update = (key: string, value: string) => {
      editedFields.current.add(key)
      setValues((current) => ({ ...current, [key]: value }))
    }

    return (
      <form onSubmit={(event) => {
        event.preventDefault()
        void onSubmit(values).catch(() => undefined)
      }}>
        <label>
          Title
          <input value={String(values.title ?? '')} onChange={(event) => update('title', event.target.value)} />
        </label>
        <label>
          Description
          <textarea value={String(values.description ?? '')} onChange={(event) => update('description', event.target.value)} />
        </label>
        <button type="submit">{submitLabel}</button>
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

const concurrentInteraction: InteractionSummary = {
  ...interaction,
  body: 'Description saved in another tab',
  updatedAt: '2026-10-22T12:00:00.000Z',
}

const conflict = Object.assign(new Error('record_modified'), {
  status: 409,
  body: {
    code: 'optimistic_lock_conflict',
    error: 'record_modified',
    expectedUpdatedAt: interaction.updatedAt,
    currentUpdatedAt: concurrentInteraction.updatedAt,
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
    readApiResultOrThrowMock
      .mockResolvedValueOnce({ items: [interaction] })
      .mockResolvedValue({ items: [concurrentInteraction] })
    apiCallOrThrowMock.mockRejectedValue(conflict)
  })

  afterEach(() => act(() => dismissRecordConflict()))

  it('preserves edited fields, refreshes untouched fields, and clears conflict state after retry', async () => {
    apiCallOrThrowMock.mockRejectedValueOnce(conflict).mockResolvedValueOnce(undefined)
    await renderTasks()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Attempted title' } })

    fireEvent.click(screen.getByRole('button', { name: /Update task/ }))

    await waitFor(() => expect(screen.getByTestId('record-conflict-banner')).toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Attempted title')
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('Description saved in another tab'))
    expect(flashMock).not.toHaveBeenCalledWith('record_modified', 'error')
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'success')
    expect(onDataRefreshMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Update task/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('record-conflict-banner')).not.toBeInTheDocument()
    expect(withScopedApiRequestHeadersMock).toHaveBeenNthCalledWith(1, {
      [OPTIMISTIC_LOCK_HEADER_NAME]: interaction.updatedAt,
    })
    expect(withScopedApiRequestHeadersMock).toHaveBeenNthCalledWith(2, {
      [OPTIMISTIC_LOCK_HEADER_NAME]: concurrentInteraction.updatedAt,
    })
    expect(apiCallOrThrowMock).toHaveBeenLastCalledWith(
      '/api/customers/interactions',
      expect.objectContaining({
        body: expect.stringContaining('Description saved in another tab'),
      }),
      expect.anything(),
    )
    expect(apiCallOrThrowMock.mock.calls.at(-1)?.[1]?.body).toContain('Attempted title')
    expect(flashMock).toHaveBeenCalledWith('Task updated', 'success')
  })

  it.each(taskActions)('does not announce success or show a raw toast for a rejected %s action', async (_name, activate) => {
    await renderTasks()
    activate()

    await waitFor(() => expect(screen.getByTestId('record-conflict-banner')).toBeInTheDocument())
    expect(flashMock).not.toHaveBeenCalledWith('record_modified', 'error')
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'success')
    expect(onDataRefreshMock).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('checkbox')).toBeEnabled()
  })
})
