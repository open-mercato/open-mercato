/**
 * @jest-environment jsdom
 *
 * Regression for #3206 — `WidgetVisibilityEditor` must route both the role and
 * user widget-visibility saves through `useGuardedMutation().runMutation(...)`
 * instead of calling `apiCallOrThrow` directly, so non-`CrudForm` writes still
 * pass through shared mutation handling (injection `onBeforeSave`/`onAfterSave`,
 * conflict surfacing, scoped headers) per `packages/ui/AGENTS.md`.
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const retryLastMutationMock = jest.fn(async () => false)
const flashMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: (options: { contextId: string }) => {
    useGuardedMutationOptions = options
    return { runMutation: runMutationMock, retryLastMutation: retryLastMutationMock }
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

let useGuardedMutationOptions: { contextId: string } | null = null

import { WidgetVisibilityEditor, type WidgetVisibilityEditorHandle } from '../WidgetVisibilityEditor'

const CATALOG = {
  items: [
    { id: 'example.dashboard.notes', title: 'Notes', description: 'Quick notes' },
    { id: 'example.dashboard.tasks', title: 'Tasks', description: 'Task list' },
  ],
}

function primeRoleLoad() {
  readApiResultOrThrowMock.mockReset()
  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/dashboards/widgets/catalog')) return CATALOG
    if (url.startsWith('/api/dashboards/roles/widgets')) {
      return { widgetIds: ['example.dashboard.notes'], hasCustom: true, scope: { tenantId: null, organizationId: null } }
    }
    if (url.startsWith('/api/dashboards/users/widgets')) {
      return {
        mode: 'override',
        widgetIds: ['example.dashboard.notes'],
        hasCustom: true,
        effectiveWidgetIds: ['example.dashboard.notes'],
        scope: { tenantId: null, organizationId: null },
      }
    }
    return {}
  })
}

describe('WidgetVisibilityEditor — guarded mutation wiring (#3206)', () => {
  beforeEach(() => {
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({ ok: true })
    runMutationMock.mockClear()
    retryLastMutationMock.mockClear()
    flashMock.mockClear()
    useGuardedMutationOptions = null
    primeRoleLoad()
  })

  it('uses a stable guarded-mutation contextId', async () => {
    const ref = React.createRef<WidgetVisibilityEditorHandle>()
    await act(async () => {
      render(<WidgetVisibilityEditor ref={ref} kind="role" targetId="role-1" />)
    })
    expect(useGuardedMutationOptions?.contextId).toBe('dashboards-widget-visibility:save')
  })

  it('routes the role save through runMutation, not a raw apiCallOrThrow', async () => {
    const ref = React.createRef<WidgetVisibilityEditorHandle>()
    await act(async () => {
      render(<WidgetVisibilityEditor ref={ref} kind="role" targetId="role-1" />)
    })

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())

    const checkbox = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
    await act(async () => {
      checkbox.click()
    })

    await act(async () => {
      await ref.current!.save()
    })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const call = runMutationMock.mock.calls[0][0]
    expect(typeof call.operation).toBe('function')
    expect(call.context.resourceKind).toBe('dashboards.role_widget_visibility')
    expect(call.context.retryLastMutation).toBe(retryLastMutationMock)

    const putCall = apiCallOrThrowMock.mock.calls.find(([url]) => url === '/api/dashboards/roles/widgets')
    expect(putCall).toBeDefined()
    expect(putCall![1].method).toBe('PUT')
    expect(flashMock).toHaveBeenCalledWith('Dashboard widgets updated', 'success')
  })

  it('routes the user save through runMutation, not a raw apiCallOrThrow', async () => {
    const ref = React.createRef<WidgetVisibilityEditorHandle>()
    await act(async () => {
      render(<WidgetVisibilityEditor ref={ref} kind="user" targetId="user-1" />)
    })

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())

    const checkbox = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
    await act(async () => {
      checkbox.click()
    })

    await act(async () => {
      await ref.current!.save()
    })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    const call = runMutationMock.mock.calls[0][0]
    expect(call.context.resourceKind).toBe('dashboards.user_widget_visibility')

    const putCall = apiCallOrThrowMock.mock.calls.find(([url]) => url === '/api/dashboards/users/widgets')
    expect(putCall).toBeDefined()
    expect(putCall![1].method).toBe('PUT')
  })
})
