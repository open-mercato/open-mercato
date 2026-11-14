/**
 * @jest-environment jsdom
 *
 * U7: the primary button only went `disabled` while the write was in flight, so
 * a slow save read as a frozen dialog. It now carries a spinner for as long as
 * the request lasts.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { NewTaskDialog } from '../NewTaskDialog'
import type { BoardStatus } from '../kanbanBoardData'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

/** Radix' Select needs pointer geometry jsdom lacks; a native select keeps the contract. */
jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  type SlotProps = { children?: React.ReactNode } & Record<string, unknown>
  const Slot = (slot: string) => {
    const Component = ({ children }: SlotProps) => ReactModule.createElement(ReactModule.Fragment, null, children)
    ;(Component as unknown as { __slot: string }).__slot = slot
    return Component
  }
  const SelectTrigger = Slot('trigger')
  const SelectContent = Slot('content')
  const SelectValue = Slot('value')
  const SelectItem = Slot('item')
  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string
    onValueChange?: (next: string) => void
    children?: React.ReactNode
  }) => {
    const nodes = ReactModule.Children.toArray(children) as React.ReactElement[]
    const trigger = nodes.find((node) => (node.type as { __slot?: string })?.__slot === 'trigger')
    const content = nodes.find((node) => (node.type as { __slot?: string })?.__slot === 'content')
    const items = content
      ? (ReactModule.Children.toArray(content.props.children) as React.ReactElement[])
      : []
    const triggerProps = (trigger?.props ?? {}) as Record<string, unknown>
    return ReactModule.createElement(
      'select',
      {
        id: triggerProps.id,
        'data-testid': triggerProps['data-testid'],
        value: value ?? '',
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value),
      },
      [
        ReactModule.createElement('option', { key: '__empty', value: '' }, ''),
        ...items.map((item) =>
          ReactModule.createElement(
            'option',
            { key: String(item.props.value), value: String(item.props.value) },
            item.props.children,
          ),
        ),
      ],
    )
  }
  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
    SelectGroup: Slot('group'),
    SelectLabel: Slot('label'),
    SelectSeparator: Slot('separator'),
  }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCallOrThrow: jest.fn() }
})

const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const STATUS_ID = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '33333333-3333-4333-8333-333333333333'

const statuses: BoardStatus[] = [
  { id: STATUS_ID, name: 'To do', slug: 'to-do', color: null, position: 0, isDefault: true, isDone: false },
]

function renderDialog(props: Partial<React.ComponentProps<typeof NewTaskDialog>> = {}) {
  const onOpenChange = props.onOpenChange ?? jest.fn()
  const onCreated = props.onCreated ?? jest.fn()
  const dialogProps = {
    open: true,
    onOpenChange,
    timeProjectId: PROJECT_ID,
    statuses,
    assigneeStaffMemberId: null,
    onCreated,
    ...props,
  }
  const utils = render(<NewTaskDialog {...dialogProps} />)
  const rerenderDialog = (nextProps: Partial<React.ComponentProps<typeof NewTaskDialog>>) =>
    utils.rerender(<NewTaskDialog {...dialogProps} {...nextProps} />)
  return { ...utils, onOpenChange, onCreated, rerenderDialog }
}

function titleInput() {
  return screen.getByTestId('board-new-task-title') as HTMLInputElement
}

function submitButton() {
  return screen.getByTestId('board-new-task-submit') as HTMLButtonElement
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApiCallOrThrow.mockResolvedValue({ ok: true, status: 200, result: { id: TASK_ID } } as never)
})

describe('NewTaskDialog — pending state (U7)', () => {
  it('shows a spinner on the primary button while the create is in flight', async () => {
    let release: (() => void) | null = null
    mockApiCallOrThrow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, result: { id: TASK_ID } } as never)
        }) as never,
    )

    const { onCreated } = renderDialog()
    fireEvent.change(titleInput(), { target: { value: 'Migracja koszyka' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(submitButton()).toBeDisabled())
    expect(screen.getByRole('status')).toBeInTheDocument()

    release?.()
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(TASK_ID))
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('carries no spinner while the dialog is idle', () => {
    renderDialog()
    fireEvent.change(titleInput(), { target: { value: 'Migracja koszyka' } })

    expect(submitButton()).not.toBeDisabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('drops the spinner and flashes when the write fails', async () => {
    mockApiCallOrThrow.mockRejectedValue(new Error('Network request failed'))

    renderDialog()
    fireEvent.change(titleInput(), { target: { value: 'Migracja koszyka' } })
    fireEvent.click(submitButton())

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Network request failed', 'error'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('NewTaskDialog — keyboard submit', () => {
  it('still creates the task on ⌘↵', async () => {
    renderDialog()
    fireEvent.change(titleInput(), { target: { value: 'Migracja koszyka' } })

    fireEvent.keyDown(screen.getByTestId('board-new-task-dialog'), { key: 'Enter', metaKey: true })

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
  })
})

describe('NewTaskDialog — draft lifecycle (#7392)', () => {
  const inProgressStatus: BoardStatus = {
    ...statuses[0],
    id: '44444444-4444-4444-8444-444444444444',
    name: 'In progress',
    slug: 'in-progress',
    position: 1,
    isDefault: false,
  }
  const boardStatuses = [...statuses, inProgressStatus]

  it('preserves the title and chosen status through a same-project status refetch', async () => {
    const { rerenderDialog } = renderDialog({ statuses: boardStatuses })
    fireEvent.change(titleInput(), { target: { value: 'Draft before scope settlement' } })
    fireEvent.change(screen.getByTestId('board-new-task-status'), { target: { value: inProgressStatus.id } })

    rerenderDialog({ statuses: [] })
    expect(titleInput()).toHaveValue('Draft before scope settlement')

    rerenderDialog({ statuses: boardStatuses.map((status) => ({ ...status })) })
    expect(titleInput()).toHaveValue('Draft before scope settlement')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(inProgressStatus.id)

    fireEvent.click(submitButton())
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledWith(
      '/api/staff/timesheets/tasks',
      expect.objectContaining({
        body: JSON.stringify({
          timeProjectId: PROJECT_ID,
          taskStatusId: inProgressStatus.id,
          title: 'Draft before scope settlement',
          assigneeStaffMemberId: null,
        }),
      }),
      expect.anything(),
    ))
  })

  it('chooses the loaded default without clearing a title typed before statuses arrive', () => {
    const { rerenderDialog } = renderDialog({ statuses: [] })
    fireEvent.change(titleInput(), { target: { value: 'Draft before statuses load' } })
    expect(submitButton()).toBeDisabled()

    rerenderDialog({ statuses: [inProgressStatus, ...statuses] })
    expect(titleInput()).toHaveValue('Draft before statuses load')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(STATUS_ID)
    expect(submitButton()).not.toBeDisabled()
  })

  it('keeps a valid selection when another status becomes the default', () => {
    const { rerenderDialog } = renderDialog({ statuses: boardStatuses })
    fireEvent.change(titleInput(), { target: { value: 'Keep the original status' } })

    rerenderDialog({ statuses: boardStatuses.map((status) => ({
      ...status,
      isDefault: status.id === inProgressStatus.id,
    })) })
    expect(titleInput()).toHaveValue('Keep the original status')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(STATUS_ID)
  })

  it('replaces a removed selection with a valid status without clearing the title', () => {
    const { rerenderDialog } = renderDialog({ statuses: boardStatuses })
    fireEvent.change(titleInput(), { target: { value: 'Keep this title' } })
    fireEvent.change(screen.getByTestId('board-new-task-status'), { target: { value: inProgressStatus.id } })

    rerenderDialog({ statuses })
    expect(titleInput()).toHaveValue('Keep this title')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(STATUS_ID)
  })

  it('uses the first available status when the loaded list has no default', () => {
    const { rerenderDialog } = renderDialog({ statuses: [] })
    rerenderDialog({ statuses: [inProgressStatus] })
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(inProgressStatus.id)
  })

  it('starts a fresh draft when reopened for the same project', () => {
    const { rerenderDialog } = renderDialog({ statuses: boardStatuses })
    fireEvent.change(titleInput(), { target: { value: 'Discarded draft' } })
    fireEvent.change(screen.getByTestId('board-new-task-status'), { target: { value: inProgressStatus.id } })

    rerenderDialog({ open: false })
    rerenderDialog({ open: true })
    expect(titleInput()).toHaveValue('')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(STATUS_ID)
  })

  it('resets for a different project even when the status IDs have not changed', () => {
    const { rerenderDialog } = renderDialog({ statuses: boardStatuses })
    fireEvent.change(titleInput(), { target: { value: 'Previous project draft' } })
    fireEvent.change(screen.getByTestId('board-new-task-status'), { target: { value: inProgressStatus.id } })

    rerenderDialog({ timeProjectId: '55555555-5555-4555-8555-555555555555' })
    expect(titleInput()).toHaveValue('')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(STATUS_ID)
  })

  it('does not reuse a previous project status while the new project loads', () => {
    const { rerenderDialog } = renderDialog()
    fireEvent.change(titleInput(), { target: { value: 'Previous project draft' } })
    const nextProjectId = '55555555-5555-4555-8555-555555555555'

    rerenderDialog({ timeProjectId: nextProjectId, statuses: [] })
    expect(titleInput()).toHaveValue('')
    fireEvent.change(titleInput(), { target: { value: 'New project draft' } })
    expect(screen.getByTestId('board-new-task-status')).toHaveValue('')
    expect(submitButton()).toBeDisabled()

    rerenderDialog({ timeProjectId: nextProjectId, statuses: [inProgressStatus] })
    expect(titleInput()).toHaveValue('New project draft')
    expect(screen.getByTestId('board-new-task-status')).toHaveValue(inProgressStatus.id)
  })
})
