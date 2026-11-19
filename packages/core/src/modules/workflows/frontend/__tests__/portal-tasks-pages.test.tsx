/**
 * @jest-environment jsdom
 */

/**
 * Portal task pages.
 *
 * Three properties, and the first is the one that is easy to lose in a refactor:
 * a portal page without a sibling `page.meta.ts` is not "unguarded by default",
 * it is SILENTLY PUBLIC — the `(frontend)` catch-all reads that file and nothing
 * else enforces the route. So the guards are asserted as data, not exercised
 * through a render.
 *
 * The other two: the list renders what the API returned (and nothing it decides
 * for itself), and an unknown `formKey` degrades to the built-in form with a
 * visible notice rather than a blank screen.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { metadata as listMeta } from '../[orgSlug]/portal/tasks/page.meta'
import { metadata as detailMeta } from '../[orgSlug]/portal/tasks/[id]/page.meta'
import PortalTasksPage from '../[orgSlug]/portal/tasks/page'
import PortalTaskDetailPage from '../[orgSlug]/portal/tasks/[id]/page'
import { clearTaskFormRenderers } from '../../lib/task-form-registry'

const mockApiCall = jest.fn()
const portalEventHandlers: Array<{ pattern: string; handler: () => void }> = []

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) => {
    const template = fallback ?? key
    if (!params) return template
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      template,
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/portal/hooks/usePortalAppEvent', () => ({
  usePortalAppEvent: (pattern: string, handler: () => void) => {
    portalEventHandlers.push({ pattern, handler })
  },
}))

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    taskName: 'Confirm delivery address',
    description: null,
    status: 'PENDING',
    dueDate: null,
    createdAt: '2026-07-28T09:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockApiCall.mockReset()
  portalEventHandlers.length = 0
  clearTaskFormRenderers()
})

describe('the page guards are declared', () => {
  test('the list page requires customer auth AND the portal view feature', () => {
    expect(listMeta.requireCustomerAuth).toBe(true)
    expect(listMeta.requireCustomerFeatures).toEqual(['portal.tasks.view'])
  })

  test('the list page declares a nav block so the grant alone lists it', () => {
    expect(listMeta.nav).toMatchObject({ labelKey: 'workflows.portal.tasks.nav', group: 'main' })
  })

  test('the DETAIL page is guarded too — a deep link is not a back door', () => {
    expect(detailMeta.requireCustomerAuth).toBe(true)
    expect(detailMeta.requireCustomerFeatures).toEqual(['portal.tasks.view'])
  })

  test('the detail page has no nav entry — it is reached from the list', () => {
    expect(detailMeta.nav).toBeUndefined()
  })

  test('reading is gated on `.view`, never on `.complete`', () => {
    // Completion is a separate grant the API enforces on its own. Requiring it
    // to READ would hide their own finished work from a view-only principal.
    for (const meta of [listMeta, detailMeta]) {
      expect(meta.requireCustomerFeatures).not.toContain('portal.tasks.complete')
    }
  })
})

describe('the list page', () => {
  test('renders the customer\'s tasks from the portal API', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { ok: true, tasks: [taskRow(), taskRow({ id: 'task-2', taskName: 'Upload your VAT ID' })] },
    })

    render(<PortalTasksPage params={{ orgSlug: 'acme' }} />)

    await waitFor(() => expect(screen.getByText('Confirm delivery address')).toBeTruthy())
    expect(screen.getByText('Upload your VAT ID')).toBeTruthy()
    expect(mockApiCall).toHaveBeenCalledWith('/api/workflows/portal/tasks')
  })

  test('splits open work from finished work', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        ok: true,
        tasks: [taskRow(), taskRow({ id: 'task-2', taskName: 'Old one', status: 'COMPLETED' })],
      },
    })

    render(<PortalTasksPage params={{ orgSlug: 'acme' }} />)

    await waitFor(() => expect(screen.getByText('Waiting on you')).toBeTruthy())
    expect(screen.getByText('Completed')).toBeTruthy()
  })

  test('an empty list says so rather than rendering an empty card', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { ok: true, tasks: [] } })

    render(<PortalTasksPage params={{ orgSlug: 'acme' }} />)

    await waitFor(() => expect(screen.getByText('Nothing needs you right now')).toBeTruthy())
  })

  test('subscribes to the portal-scoped assignment event so a new task appears without a reload', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { ok: true, tasks: [] } })

    render(<PortalTasksPage params={{ orgSlug: 'acme' }} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))

    expect(portalEventHandlers[0].pattern).toBe('workflows.task.portal_assigned')

    await act(async () => {
      portalEventHandlers[0].handler()
    })
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
  })
})

describe('the detail page', () => {
  function detailResponse(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 200,
      result: {
        ok: true,
        task: {
          id: 'task-1',
          taskName: 'Confirm delivery address',
          description: null,
          status: 'PENDING',
          dueDate: null,
          formSchema: { fields: [{ name: 'street', type: 'text', label: 'Street' }] },
          formData: null,
          entityBindings: null,
        },
        decisions: [],
        formKey: null,
        canComplete: true,
        ...overrides,
      },
    }
  }

  test('renders the completion form for the assignee', async () => {
    mockApiCall.mockResolvedValue(detailResponse())

    render(<PortalTaskDetailPage params={{ orgSlug: 'acme', id: 'task-1' }} />)

    await waitFor(() => expect(screen.getByText('Street')).toBeTruthy())
    expect(screen.getByText('Complete task')).toBeTruthy()
  })

  test('an unknown formKey degrades to the built-in form WITH a visible notice', async () => {
    // The registry is a lookup, never a gate: a blank screen is the one outcome
    // this must never produce, and a silent fallback is the other.
    mockApiCall.mockResolvedValue(detailResponse({ formKey: 'enterprise:credit-check' }))

    render(<PortalTaskDetailPage params={{ orgSlug: 'acme', id: 'task-1' }} />)

    await waitFor(() =>
      expect(
        screen.getByText(
          'This task asks for the "enterprise:credit-check" form, which is not available here. The standard form is shown instead.',
        ),
      ).toBeTruthy(),
    )
    // The built-in form is still there — the notice replaces nothing.
    expect(screen.getByText('Street')).toBeTruthy()
    expect(screen.getByText('Complete task')).toBeTruthy()
  })

  test('authored decisions REPLACE the generic complete button', async () => {
    mockApiCall.mockResolvedValue(
      detailResponse({
        decisions: [
          { id: 'approve', label: 'Approve' },
          { id: 'reject', label: { en: 'Reject' } },
        ],
      }),
    )

    render(<PortalTaskDetailPage params={{ orgSlug: 'acme', id: 'task-1' }} />)

    await waitFor(() => expect(screen.getByText('Approve')).toBeTruthy())
    expect(screen.getByText('Reject')).toBeTruthy()
    expect(screen.queryByText('Complete task')).toBeNull()
  })

  test('a reader who may not act gets the work read-only, with the reason', async () => {
    mockApiCall.mockResolvedValue(detailResponse({ canComplete: false }))

    render(<PortalTaskDetailPage params={{ orgSlug: 'acme', id: 'task-1' }} />)

    await waitFor(() =>
      expect(
        screen.getByText(
          'You can see this task because it belongs to your company. Only the person it is assigned to can complete it.',
        ),
      ).toBeTruthy(),
    )
    expect(screen.queryByText('Complete task')).toBeNull()
  })

  test('a 404 renders the neutral not-available message, never an error dump', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 404, result: { ok: false, error: 'Task not found' } })

    render(<PortalTaskDetailPage params={{ orgSlug: 'acme', id: 'task-1' }} />)

    await waitFor(() => expect(screen.getByText('Task not available')).toBeTruthy())
  })
})
