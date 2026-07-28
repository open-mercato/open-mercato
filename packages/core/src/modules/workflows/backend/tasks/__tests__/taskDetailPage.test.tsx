/**
 * @jest-environment jsdom
 */

/**
 * Task detail — decision beside context (spec §6.2).
 *
 * What is asserted here is what the surface promises: the buttons come from the
 * definition (never a column), pressing one both completes the task and tells
 * the server WHICH one, the claim and claim-next affordances hit the endpoints
 * that actually exist, and a task with no decisions still completes through the
 * plain form — the regression that matters, because decisions are additive.
 */

import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallbackOrVars?: unknown) =>
  typeof fallbackOrVars === 'string' ? fallbackOrVars : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title, statusBadge }: { title?: React.ReactNode; statusBadge?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {statusBadge}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/JsonDisplay', () => ({
  JsonDisplay: ({ title }: { title?: string }) => <div data-testid="json-display">{title}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({
    children,
    asChild,
    ...rest
  }: {
    children?: React.ReactNode
    asChild?: boolean
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    asChild ? <>{children}</> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

jest.mock('@open-mercato/ui/primitives/separator', () => ({
  Separator: () => <hr />,
}))

jest.mock('@open-mercato/ui/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}))

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

/**
 * `useGuardedMutation` is the project rule for a non-`CrudForm` page. It is
 * stubbed to run the operation straight through, and the stub records that the
 * page went through it at all — bypassing it is exactly the regression the rule
 * exists to prevent.
 */
const runMutationSpy = jest.fn()
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation, context }: { operation: () => Promise<unknown>; context: unknown }) => {
      runMutationSpy(context)
      return operation()
    },
    retryLastMutation: async () => false,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => {
  const ReactModule = require('react') as typeof React
  return {
    useQuery: ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
      const [state, setState] = ReactModule.useState<{ data: unknown; isLoading: boolean; error: unknown }>({
        data: undefined,
        isLoading: true,
        error: null,
      })
      const key = JSON.stringify(queryKey)
      ReactModule.useEffect(() => {
        let cancelled = false
        Promise.resolve()
          .then(() => queryFn())
          .then((data) => {
            if (!cancelled) setState({ data, isLoading: false, error: null })
          })
          .catch((error: unknown) => {
            if (!cancelled) setState({ data: undefined, isLoading: false, error })
          })
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key])
      return state
    },
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  }
})

jest.mock('lucide-react', () => ({
  AlertTriangle: () => null,
  ArrowDown: () => null,
  ArrowUp: () => null,
  CheckCircle2: () => null,
  Circle: () => null,
  Clock: () => null,
  Flame: () => null,
  Loader: () => null,
  Minus: () => null,
  XCircle: () => null,
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

import UserTaskDetailPage from '../[id]/page'

const TASK_ID = 'task-1'

type TaskPayload = Record<string, unknown>

function baseTask(overrides: TaskPayload = {}): TaskPayload {
  return {
    id: TASK_ID,
    workflowInstanceId: 'instance-1',
    stepInstanceId: 'step-1',
    taskName: 'Review refund',
    description: 'Check the customer history first.',
    status: 'IN_PROGRESS',
    formSchema: null,
    formData: null,
    assignedTo: 'user-1',
    assignedToRoles: null,
    claimedBy: 'user-1',
    claimedAt: null,
    dueDate: null,
    completedBy: null,
    completedAt: null,
    comments: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    priority: 'high',
    entityBindings: [],
    stepId: 'review',
    decisions: [],
    ...overrides,
  }
}

function mockTask(task: TaskPayload) {
  apiCallMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      return { ok: true, status: 200, result: { data: task } } as never
    }
    if (url.endsWith('/work-inbox/next')) {
      return { ok: true, status: 200, result: { data: { id: 'task-2' } } } as never
    }
    return { ok: true, status: 200, result: { data: task } } as never
  })
}

function renderPage() {
  return render(<UserTaskDetailPage params={{ id: TASK_ID }} />)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('decision buttons', () => {
  const decisions = [
    { id: 'approve', label: 'Approve refund', transitionId: 't_approve' },
    { id: 'reject', label: 'Reject refund', transitionId: 't_reject', style: 'destructive' },
  ]

  test('render from the definition the API resolved, not from a stored column', async () => {
    mockTask(baseTask({ decisions }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-decisions')).toBeTruthy())
    expect(screen.getByTestId('task-decision-approve').textContent).toBe('Approve refund')
    expect(screen.getByTestId('task-decision-reject').textContent).toBe('Reject refund')
    // A step that offers named outcomes must not also offer an unnamed one.
    expect(screen.queryByTestId('task-complete')).toBeNull()
  })

  test('pressing one completes the task AND tells the server which button it was', async () => {
    mockTask(baseTask({ decisions }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-decision-reject')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-decision-reject'))

    await waitFor(() => {
      const completeCall = apiCallMock.mock.calls.find(([url]) =>
        String(url).endsWith(`/api/workflows/tasks/${TASK_ID}/complete`),
      )
      expect(completeCall).toBeTruthy()
      const body = JSON.parse(String((completeCall?.[1] as { body?: string })?.body))
      expect(body.decisionId).toBe('reject')
    })
    expect(runMutationSpy).toHaveBeenCalled()
  })

  test('the recorded decision is shown back on a completed task', async () => {
    mockTask(
      baseTask({
        status: 'COMPLETED',
        decisions,
        formData: { __decision: 'approve', note: 'ok' },
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Approve refund')).toBeTruthy())
    expect(screen.getByText('workflows.tasks.detail.decisionTaken:')).toBeTruthy()
  })
})

/**
 * Regression: decisions are additive. A task on a step that authored none keeps
 * the plain complete-the-form path it has always had.
 */
describe('a task with no decisions', () => {
  test('still completes through the plain form, with no decisionId on the wire', async () => {
    mockTask(baseTask({ decisions: [] }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-complete')).toBeTruthy())
    expect(screen.queryByTestId('task-decisions')).toBeNull()

    fireEvent.click(screen.getByTestId('task-complete'))

    await waitFor(() => {
      const completeCall = apiCallMock.mock.calls.find(([url]) =>
        String(url).endsWith(`/api/workflows/tasks/${TASK_ID}/complete`),
      )
      expect(completeCall).toBeTruthy()
      const body = JSON.parse(String((completeCall?.[1] as { body?: string })?.body))
      expect(body.decisionId).toBeUndefined()
    })
  })
})

describe('claim', () => {
  test('offers the claim button for a role-queued task and posts to the claim endpoint', async () => {
    mockTask(
      baseTask({
        status: 'PENDING',
        assignedTo: null,
        claimedBy: null,
        assignedToRoles: ['approver'],
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-claim')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-claim'))

    await waitFor(() =>
      expect(
        apiCallMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/workflows/tasks/${TASK_ID}/claim` &&
            (init as { method?: string } | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    )
  })

  test('is not offered for a task already owned by someone', async () => {
    mockTask(baseTask({ status: 'IN_PROGRESS', claimedBy: 'user-1' }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-complete')).toBeTruthy())
    expect(screen.queryByTestId('task-claim')).toBeNull()
  })
})

describe('next task after completion', () => {
  test('claims the next item and navigates to it', async () => {
    mockTask(baseTask({ status: 'COMPLETED', formData: { note: 'ok' } }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-next')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-next'))

    await waitFor(() =>
      expect(
        apiCallMock.mock.calls.some(
          ([url, init]) =>
            String(url) === '/api/workflows/work-inbox/next' &&
            (init as { method?: string } | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/backend/tasks/task-2'))
  })

  test('is not offered while the task is still open', async () => {
    mockTask(baseTask())
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-complete')).toBeTruthy())
    expect(screen.queryByTestId('task-next')).toBeNull()
  })
})

describe('the record context column', () => {
  test('deep-links a bound record and degrades when the type has no detail page', async () => {
    mockTask(
      baseTask({
        entityBindings: [
          { entityType: 'customers:person', entityId: 'person-1', label: 'Ada Lovelace' },
          { entityType: 'inventory:bin', entityId: 'bin-9', label: 'Bin 9' },
        ],
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy())
    const links = screen.getAllByText('workflows.tasks.detail.records.open')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/backend/customers/people-v2/person-1')
    expect(screen.getByText('workflows.tasks.detail.records.noLink')).toBeTruthy()
  })

  test('says so when the task is about nothing', async () => {
    mockTask(baseTask())
    renderPage()

    await waitFor(() => expect(screen.getByText('workflows.tasks.detail.records.empty')).toBeTruthy())
  })
})
