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

/**
 * The reassign dialog is a real Radix modal; rendering it headlessly here keeps
 * the assertions about WHAT the page offers and to which endpoint, not about
 * portal mechanics. Its own keyboard contract (Cmd/Ctrl+Enter submit, Escape
 * cancel) is asserted separately in `reassignTaskDialog.test.tsx`.
 */
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}))

// The reassign form is a rail now, so the drawer primitive is the one this
// page renders it through. Keep `closeAriaLabel` off the DOM node — it is a
// DrawerContent prop, not an attribute.
jest.mock('@open-mercato/ui/primitives/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({
    children,
    closeAriaLabel: _closeAriaLabel,
    side: _side,
    hideCloseButton: _hideCloseButton,
    ...rest
  }: {
    children?: React.ReactNode
    closeAriaLabel?: string
    side?: string
    hideCloseButton?: boolean
  }) => <div {...rest}>{children}</div>,
  DrawerHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerFooter: ({ leading, children }: { leading?: React.ReactNode; children?: React.ReactNode }) => (
    <div>{leading}{children}</div>
  ),
  DrawerTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  DrawerClose: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...rest}>{children}</label>
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/kbd', () => ({
  Kbd: ({ children }: { children?: React.ReactNode }) => <kbd>{children}</kbd>,
  KbdShortcut: ({ keys }: { keys: string[] }) => <kbd>{keys.join('+')}</kbd>,
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

const scopedHeadersSpy = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: async (headers: unknown, run: () => Promise<unknown>) => {
    scopedHeadersSpy(headers)
    return run()
  },
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

/**
 * Every affordance is gated by what the SERVER said (§6.4).
 *
 * The bug these cover: `workflows.tasks.view_all` makes a colleague's task
 * READABLE and never actable, so the page used to render a Complete button that
 * answered 409 on every click, with no reassign control to reach the documented
 * remedy. The payloads below differ from the old client-side derivation on
 * purpose — a page that still derives from `status` fails every one of them.
 */
describe('act surfaces come from the server', () => {
  test('an open task the caller may not complete offers no complete button', async () => {
    mockTask(
      baseTask({
        status: 'IN_PROGRESS',
        assignedTo: 'someone-else',
        claimedBy: 'someone-else',
        canComplete: false,
        canClaim: false,
        canRelease: false,
        canReassign: true,
        actBlockedReason: 'owned-by-another',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    expect(screen.queryByTestId('task-complete')).toBeNull()
    expect(screen.queryByTestId('task-decisions')).toBeNull()
  })

  test('states WHY, and names reassignment as the remedy', async () => {
    mockTask(
      baseTask({
        status: 'PENDING',
        assignedTo: null,
        claimedBy: null,
        assignedToRoles: null,
        canComplete: false,
        canReassign: true,
        actBlockedReason: 'unowned',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    expect(screen.getByText(/workflows\.tasks\.detail\.blocked\.unowned/)).toBeTruthy()
    expect(screen.getByText(/workflows\.tasks\.detail\.blocked\.reassignRemedy/)).toBeTruthy()
    expect(screen.getByTestId('task-reassign')).toBeTruthy()
  })

  test('a caller who cannot reassign is told who can, and gets no dead button', async () => {
    mockTask(
      baseTask({
        status: 'PENDING',
        assignedTo: 'someone-else',
        canComplete: false,
        canReassign: false,
        actBlockedReason: 'owned-by-another',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    expect(screen.getByText(/workflows\.tasks\.detail\.blocked\.reassignUnavailable/)).toBeTruthy()
    expect(screen.queryByTestId('task-reassign')).toBeNull()
  })

  /**
   * The entity-gate refusal is answered as a bare 404 by every act route, so the
   * page must be equally mute: no binding, no entity type, no `denied:` code.
   */
  test('the non-diagnostic refusal stays non-diagnostic', async () => {
    mockTask(
      baseTask({
        status: 'PENDING',
        entityBindings: [{ entityType: 'sales:sales_order', entityId: 'order-1' }],
        canComplete: false,
        canReassign: false,
        actBlockedReason: 'unavailable',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    const notice = screen.getByTestId('task-act-blocked')
    expect(notice.textContent).toContain('workflows.tasks.detail.blocked.unavailable')
    expect(notice.textContent).not.toContain('denied:')
    expect(notice.textContent).not.toContain('sales:sales_order')
    expect(screen.queryByTestId('task-reassign')).toBeNull()
  })

  test('claim is withheld when the server says so, however claimable the row looks', async () => {
    mockTask(
      baseTask({
        status: 'PENDING',
        assignedTo: null,
        claimedBy: null,
        assignedToRoles: ['approver'],
        canComplete: false,
        canClaim: false,
        canReassign: false,
        actBlockedReason: 'not-in-your-queue',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    expect(screen.queryByTestId('task-claim')).toBeNull()
  })

  test('release is offered only when the server says the caller holds the claim', async () => {
    mockTask(
      baseTask({ status: 'IN_PROGRESS', claimedBy: 'user-1', canComplete: true, canRelease: true }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-release')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-release'))

    await waitFor(() =>
      expect(
        apiCallMock.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/workflows/tasks/${TASK_ID}/unclaim` &&
            (init as { method?: string } | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    )
    expect(runMutationSpy).toHaveBeenCalled()
  })

  test('no release button when the claim is somebody else', async () => {
    mockTask(
      baseTask({
        status: 'IN_PROGRESS',
        claimedBy: 'someone-else',
        canComplete: false,
        canRelease: false,
        canReassign: false,
        actBlockedReason: 'owned-by-another',
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-act-blocked')).toBeTruthy())
    expect(screen.queryByTestId('task-release')).toBeNull()
  })

  /**
   * Additive-compatibility: a payload written before the fields existed keeps
   * the pre-change behaviour exactly. (The pre-existing suites above run against
   * exactly such payloads, which is the rest of this guarantee.)
   */
  test('a payload carrying none of the fields behaves as it always did', async () => {
    mockTask(baseTask({ status: 'IN_PROGRESS' }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-complete')).toBeTruthy())
    expect(screen.queryByTestId('task-act-blocked')).toBeNull()
    expect(screen.queryByTestId('task-reassign')).toBeNull()
    expect(screen.queryByTestId('task-release')).toBeNull()
  })
})

describe('reassignment', () => {
  const reassignable = {
    status: 'PENDING' as const,
    assignedTo: 'someone-else',
    canComplete: false,
    canReassign: true,
    actBlockedReason: 'owned-by-another' as const,
  }

  test('opens the dialog and posts the target to the reassign endpoint', async () => {
    mockTask(baseTask(reassignable))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-reassign')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-reassign'))

    await waitFor(() => expect(screen.getByTestId('task-reassign-assignee')).toBeTruthy())
    fireEvent.change(screen.getByTestId('task-reassign-assignee'), {
      target: { value: 'user-7' },
    })
    fireEvent.change(screen.getByTestId('task-reassign-reason'), {
      target: { value: 'taking it over' },
    })
    fireEvent.click(screen.getByTestId('task-reassign-submit'))

    await waitFor(() => {
      const call = apiCallMock.mock.calls.find(([url]) =>
        String(url).endsWith(`/api/workflows/tasks/${TASK_ID}/reassign`),
      )
      expect(call).toBeTruthy()
      expect((call?.[1] as { method?: string })?.method).toBe('POST')
      const body = JSON.parse(String((call?.[1] as { body?: string })?.body))
      expect(body).toEqual({
        assignedTo: 'user-7',
        assignedToRoles: null,
        reason: 'taking it over',
      })
    })
    expect(runMutationSpy).toHaveBeenCalled()
  })

  test('sends the row optimistic-lock version, so two administrators racing get a 409', async () => {
    mockTask(baseTask(reassignable))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-reassign')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-reassign'))
    await waitFor(() => expect(screen.getByTestId('task-reassign-assignee')).toBeTruthy())
    fireEvent.change(screen.getByTestId('task-reassign-assignee'), { target: { value: 'user-7' } })
    fireEvent.click(screen.getByTestId('task-reassign-submit'))

    await waitFor(() =>
      expect(scopedHeadersSpy).toHaveBeenCalledWith({
        'x-om-ext-optimistic-lock-expected-updated-at': '2026-07-01T10:00:00.000Z',
      }),
    )
  })

  test('splits a role queue and refuses a body naming no target at all', async () => {
    mockTask(baseTask(reassignable))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-reassign')).toBeTruthy())
    fireEvent.click(screen.getByTestId('task-reassign'))
    await waitFor(() => expect(screen.getByTestId('task-reassign-submit')).toBeTruthy())

    fireEvent.click(screen.getByTestId('task-reassign-submit'))
    await waitFor(() => expect(screen.getByTestId('task-reassign-target-required')).toBeTruthy())
    expect(
      apiCallMock.mock.calls.some(([url]) => String(url).endsWith('/reassign')),
    ).toBe(false)

    fireEvent.change(screen.getByTestId('task-reassign-roles'), {
      target: { value: ' approver , warehouse ' },
    })
    fireEvent.click(screen.getByTestId('task-reassign-submit'))

    await waitFor(() => {
      const call = apiCallMock.mock.calls.find(([url]) => String(url).endsWith('/reassign'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call?.[1] as { body?: string })?.body))
      expect(body.assignedToRoles).toEqual(['approver', 'warehouse'])
      expect(body.assignedTo).toBeNull()
    })
  })

  test('is offered on a task the caller CAN complete — the gate is visibility, not ownership', async () => {
    mockTask(
      baseTask({ status: 'IN_PROGRESS', canComplete: true, canReassign: true }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('task-complete')).toBeTruthy())
    expect(screen.getByTestId('task-reassign')).toBeTruthy()
    expect(screen.queryByTestId('task-act-blocked')).toBeNull()
  })
})
