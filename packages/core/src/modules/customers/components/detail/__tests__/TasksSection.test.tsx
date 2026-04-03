/**
 * @jest-environment jsdom
 */
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TasksSection } from '../TasksSection'

const usePersonTasksMock = jest.fn()
const useInteractionsMock = jest.fn()

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
  TabEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

jest.mock('../../../lib/interactionCompatibility', () => ({
  mapInteractionRecordToTodoSummary: jest.fn((interaction: unknown) => interaction),
}))

describe('TasksSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
})
