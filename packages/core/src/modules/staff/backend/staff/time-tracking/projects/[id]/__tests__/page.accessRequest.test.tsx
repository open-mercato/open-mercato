/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

import TimesheetProjectDetailPage from '../page'
import TimeTrackingProjectEditPage from '../edit/page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
let mockScopeVersion = 0
let mockTranslationRevision = 0
const translations = [
  (key: string, fallback?: string) => fallback ?? key,
  (key: string, fallback?: string) => fallback ?? key,
]
let mockGuard: Promise<void> | undefined

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/context')
  return { ...actual, useT: () => translations[mockTranslationRevision], useLocale: () => 'en' }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/projects/project-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => { await mockGuard; return operation() },
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  KpiCard: ({ label }: { label: React.ReactNode }) => <div>{label}</div>,
  Sparkline: () => null,
}))

jest.mock('../../../../../../lib/time-tracking-ui/ProjectTeamDrawer', () => ({
  ProjectTeamDrawer: () => null,
}))


jest.mock('../../projectFormConfig', () => ({
  createProjectFormSchema: () => ({}),
  createProjectFormFields: () => [],
  createProjectFormGroups: () => [],
}))

const denied = { ok: false, status: 404, result: { reason: 'no_project_access' }, response: {} }
const apiCallMock = jest.mocked(apiCall)
const requestMock = jest.mocked(apiCallOrThrow)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setScope(organization = 'org-a', tenant = 'tenant-a') {
  document.cookie = `om_selected_org=${organization}; path=/`
  document.cookie = `om_selected_tenant=${tenant}; path=/`
}

beforeEach(() => {
  jest.clearAllMocks()
  mockScopeVersion = 0
  mockTranslationRevision = 0
  mockGuard = undefined
  setScope()
  apiCallMock.mockImplementation(async (url) => url.toString().includes('/time-projects?')
    ? denied
    : { ok: true, status: 200, result: { items: [] }, response: {} } as never)
  requestMock.mockResolvedValue({} as never)
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [] })
})

afterEach(() => {
  document.cookie = 'om_selected_org=; max-age=0; path=/'
  document.cookie = 'om_selected_tenant=; max-age=0; path=/'
})

describe.each([
  ['detail', TimesheetProjectDetailPage],
  ['edit', TimeTrackingProjectEditPage],
])('%s project access request', (_name, ProjectPage) => {
  function renderProject(projectId = PROJECT_ID) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const content = (id: string) => <QueryClientProvider client={queryClient}><ProjectPage params={{ id }} /></QueryClientProvider>
    const rendered = render(content(projectId))
    return { ...rendered, refresh: (id = projectId) => rendered.rerender(content(id)) }
  }

  async function sendRequest() {
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled())
  }

  it.each(['organization bootstrap', 'translation refresh'])('retains the acknowledgement throughout a same-scope %s', async (cause) => {
    const { refresh } = renderProject()
    await sendRequest()
    const reload = deferred<typeof denied>()
    apiCallMock.mockImplementation(async (url) => url.toString().includes('/time-projects?') ? reload.promise : {} as never)
    if (cause === 'organization bootstrap') mockScopeVersion += 1
    else mockTranslationRevision = 1
    refresh()
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()
    await act(async () => { reload.resolve(denied) })
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it.each(['organization', 'tenant', 'project'])('resets acknowledgement and hides actions until a changed %s is checked', async (scope) => {
    const { refresh } = renderProject()
    await sendRequest()
    const reload = deferred<typeof denied>()
    apiCallMock.mockImplementation(async (url) => url.toString().includes('/time-projects?') ? reload.promise : {} as never)
    if (scope === 'organization') setScope('org-b')
    if (scope === 'tenant') setScope('org-a', 'tenant-b')
    mockScopeVersion += 1
    refresh(scope === 'project' ? 'project-b' : PROJECT_ID)
    expect(screen.queryByRole('button', { name: 'Request sent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument()
    expect(screen.getByText('Loading project...')).toBeInTheDocument()
    await act(async () => { reload.resolve(denied) })
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeEnabled()
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not submit a guarded request after the organization changes', async () => {
    const guard = deferred<void>()
    mockGuard = guard.promise
    const { refresh } = renderProject()
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    setScope('org-b')
    mockScopeVersion += 1
    refresh()
    await act(async () => { guard.resolve() })
    expect(requestMock).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeEnabled()
  })

  it('ignores completion from a request started in the previous organization', async () => {
    const request = deferred<never>()
    requestMock.mockReturnValue(request.promise)
    const { refresh } = renderProject()
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1))
    setScope('org-b')
    mockScopeVersion += 1
    refresh()
    await act(async () => { request.resolve({} as never) })
    expect(flash).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Request sent' })).not.toBeInTheDocument()
  })

  it('does not submit a guarded request after leaving the page', async () => {
    const guard = deferred<void>()
    mockGuard = guard.promise
    const { unmount } = renderProject()
    fireEvent.click(await screen.findByRole('button', { name: 'Request access' }))
    unmount()
    await act(async () => { guard.resolve() })
    expect(requestMock).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })

  it('shows a reload failure instead of retaining a stale denial', async () => {
    const { refresh } = renderProject()
    await sendRequest()
    apiCallMock.mockResolvedValue({ ok: false, status: 500, result: {}, response: {} } as never)
    mockScopeVersion += 1
    refresh()
    expect(await screen.findByText('Failed to load project.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request sent' })).not.toBeInTheDocument()
  })
})
