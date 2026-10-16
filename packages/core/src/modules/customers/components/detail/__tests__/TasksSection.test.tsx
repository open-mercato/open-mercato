/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TodoLinkSummary } from '../types'
import { TasksSection } from '../TasksSection'

const usePersonTasksMock = jest.fn()
const useInteractionsMock = jest.fn()
const confirmMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
    ConfirmDialogElement: <div data-testid="confirm-dialog-element" />,
  }),
}))

jest.mock('../hooks/usePersonTasks', () => ({
  usePersonTasks: (...args: unknown[]) => usePersonTasksMock(...args),
}))

jest.mock('../hooks/useInteractions', () => ({
  useInteractions: (...args: unknown[]) => useInteractionsMock(...args),
}))

jest.mock('../TaskDialog', () => ({
  TaskDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: () => null,
  TabEmptyState: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}))

jest.mock('../../../lib/interactionCompatibility', () => ({
  mapInteractionRecordToTodoSummary: jest.fn((interaction: unknown) => interaction),
}))

const sampleTask: TodoLinkSummary = {
  id: 'link-1',
  todoId: 'todo-1',
  todoSource: 'customers',
  createdAt: '2026-01-01T10:00:00.000Z',
  title: 'Follow up call',
}

describe('TasksSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    usePersonTasksMock.mockReturnValue({
      tasks: [],
      isInitialLoading: false,
      isLoadingMore: false,
      isMutating: false,
      hasMore: false,
      pendingTaskId: null,
      error: null,
      loadMore: jest.fn(async () => undefined),
      refresh: jest.fn(async () => undefined),
      createTask: jest.fn(async () => undefined),
      updateTask: jest.fn(async () => undefined),
      toggleTask: jest.fn(async () => undefined),
      unlinkTask: jest.fn(async () => undefined),
    })
    useInteractionsMock.mockReturnValue({
      interactions: [],
      isInitialLoading: false,
      isLoadingMore: false,
      isMutating: false,
      hasMore: false,
      pendingId: null,
      error: null,
      loadMore: jest.fn(async () => undefined),
      refresh: jest.fn(async () => undefined),
      createInteraction: jest.fn(async () => undefined),
      updateInteraction: jest.fn(async () => undefined),
      completeInteraction: jest.fn(async () => undefined),
      deleteInteraction: jest.fn(async () => undefined),
    })
  })

  it('keeps the View all tasks navigation visible even when the task list is empty', () => {
    renderWithProviders(
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        emptyLabel="No date"
        addActionLabel="Create task"
        emptyState={{
          title: 'No tasks yet',
          actionLabel: 'Create task',
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'View all tasks' })).toHaveAttribute('href', '/backend/customer-tasks')
  })

  it('emits the persistent section action when entityId is provided', () => {
    const onActionChange = jest.fn()
    renderWithProviders(
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        emptyLabel="No date"
        addActionLabel="Create task"
        emptyState={{ title: 'No tasks yet', actionLabel: 'Create task' }}
        onActionChange={onActionChange}
      />,
    )
    const lastNonNull = [...onActionChange.mock.calls]
      .map((call) => call[0])
      .reverse()
      .find((value) => value !== null)
    expect(lastNonNull).not.toBeUndefined()
    expect(lastNonNull.label).toBe('Create task')
  })

  it('omits the inline empty-state CTA so the section header owns the action', () => {
    renderWithProviders(
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        emptyLabel="No date"
        addActionLabel="Create task"
        emptyState={{ title: 'No tasks yet', actionLabel: 'Create task' }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull()
    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
  })

  it('loads native and legacy tasks through the mounted compatibility loader after remounting', async () => {
    const nativeRow = {
      id: 'native-task',
      todoId: 'native-task',
      todoSource: 'customers:interaction',
      todoTitle: 'Native follow up',
      todoIsDone: true,
      todoUpdatedAt: '2026-10-16T10:00:00.000Z',
      createdAt: '2026-10-16T09:00:00.000Z',
    }
    const legacyRow = {
      ...nativeRow,
      id: 'legacy-link',
      todoId: 'legacy-todo',
      todoSource: 'example:todo',
      todoTitle: 'Legacy follow up',
      todoIsDone: false,
    }
    readApiResultOrThrowMock.mockImplementation(async (path: string) => ({
      items: path.startsWith('/api/customers/interactions/tasks?') ? [nativeRow, legacyRow] : [legacyRow],
      total: 2,
      page: 1,
      pageSize: 20,
    }))
    usePersonTasksMock.mockImplementation(jest.requireActual('../hooks/usePersonTasks').usePersonTasks)
    const section = (
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        emptyLabel="No date"
        addActionLabel="Create task"
        emptyState={{ title: 'No tasks yet', actionLabel: 'Create task' }}
      />
    )

    const firstMount = renderWithProviders(section)
    expect(await screen.findByText('Native follow up')).toBeInTheDocument()
    expect(screen.getByText('Legacy follow up')).toBeInTheDocument()
    expect(screen.queryByText('No tasks yet')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    expect(screen.getAllByRole('checkbox').filter((checkbox) => (checkbox as HTMLInputElement).checked)).toHaveLength(1)

    firstMount.unmount()
    renderWithProviders(section)

    expect(await screen.findByText('Native follow up')).toBeInTheDocument()
    expect(screen.getByText('Legacy follow up')).toBeInTheDocument()
  })

  it('continues to render unified tasks from the canonical interactions loader', () => {
    useInteractionsMock.mockReturnValue({
      ...useInteractionsMock(),
      interactions: [{ ...sampleTask, id: 'native-task', todoId: 'native-task', title: 'Unified task', status: 'canceled' }],
    })

    renderWithProviders(
      <TasksSection
        entityId="customer-1"
        initialTasks={[]}
        useCanonicalInteractions
        emptyLabel="No date"
        addActionLabel="Create task"
        emptyState={{ title: 'No tasks yet', actionLabel: 'Create task' }}
      />,
    )

    expect(screen.getByText('Unified task')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(useInteractionsMock).toHaveBeenLastCalledWith({ entityId: 'customer-1', typeFilter: 'task' })
  })

  describe('delete confirmation (#5937)', () => {
    function renderWithTask(unlinkTask: jest.Mock) {
      usePersonTasksMock.mockReturnValue({
        tasks: [sampleTask],
        isInitialLoading: false,
        isLoadingMore: false,
        isMutating: false,
        hasMore: false,
        pendingTaskId: null,
        error: null,
        loadMore: jest.fn(async () => undefined),
        refresh: jest.fn(async () => undefined),
        createTask: jest.fn(async () => undefined),
        updateTask: jest.fn(async () => undefined),
        toggleTask: jest.fn(async () => undefined),
        unlinkTask,
      })
      return renderWithProviders(
        <TasksSection
          entityId="customer-1"
          initialTasks={[sampleTask]}
          emptyLabel="No date"
          addActionLabel="Create task"
          emptyState={{ title: 'No tasks yet', actionLabel: 'Create task' }}
        />,
      )
    }

    it('mounts the confirmation dialog element so confirm() has a host', () => {
      renderWithTask(jest.fn(async () => undefined))
      expect(screen.getByTestId('confirm-dialog-element')).toBeInTheDocument()
    })

    it('asks for destructive confirmation before deleting instead of deleting on the first click', async () => {
      const unlinkTask = jest.fn(async () => undefined)
      // Leave the confirmation unresolved: this models the user still looking at
      // the dialog, which is exactly the window in which the bug deleted the task.
      confirmMock.mockReturnValue(new Promise<boolean>(() => {}))
      renderWithTask(unlinkTask)

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      expect(confirmMock).toHaveBeenCalledTimes(1)
      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
      expect(unlinkTask).not.toHaveBeenCalled()
    })

    it('deletes the task once the confirmation is approved', async () => {
      const unlinkTask = jest.fn(async () => undefined)
      confirmMock.mockResolvedValue(true)
      renderWithTask(unlinkTask)

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(unlinkTask).toHaveBeenCalledTimes(1))
      expect(unlinkTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'link-1', todoId: 'todo-1' }))
    })

    it('leaves the task untouched when the confirmation is dismissed', async () => {
      const unlinkTask = jest.fn(async () => undefined)
      confirmMock.mockResolvedValue(false)
      renderWithTask(unlinkTask)

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
      expect(unlinkTask).not.toHaveBeenCalled()
    })
  })
})
