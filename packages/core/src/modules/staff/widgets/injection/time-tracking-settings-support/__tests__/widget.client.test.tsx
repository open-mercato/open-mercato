/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import SupportSettingsTab from '../widget.client'

const FALLBACK_RULE = '55555555-5555-4555-8555-555555555551'
const BILLING_RULE = '55555555-5555-4555-8555-555555555552'
const FALLBACK_PROJECT = '44444444-4444-4444-8444-444444444440'
const PROJECT_X = '44444444-4444-4444-8444-444444444441'
const PROJECT_Y = '44444444-4444-4444-8444-444444444442'
const PROJECT_Z = '44444444-4444-4444-8444-444444444443'
const VERSION_FALLBACK = '2026-05-01T09:00:00.000Z'
const VERSION_X = '2026-05-01T10:00:00.000Z'
const VERSION_Y = '2026-05-01T10:05:00.000Z'
const PREVIEW_URL = '/api/staff/timesheets/support-routing-rules/preview'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: [] }, isReady: true }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: { items: [] } })),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(async () => ({ ok: true })),
  updateCrud: jest.fn(async () => ({ ok: true })),
  deleteCrud: jest.fn(async () => ({ ok: true })),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <input aria-label="project" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryForm', () => ({
  DictionaryForm: () => null,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryTable', () => ({
  DictionaryTable: () => null,
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  ICON_SUGGESTIONS: [],
}))

const mockReadApiResult = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockUpdateCrud = updateCrud as jest.MockedFunction<typeof updateCrud>
const mockSurfaceConflict = surfaceRecordConflict as jest.MockedFunction<typeof surfaceRecordConflict>

function project(id: string) {
  return { id, name: id, code: null, status: 'active', usable: true }
}

function snapshot(billing: { projectId: string; version: string } | null) {
  const fallback = {
    id: FALLBACK_RULE,
    categoryValue: null,
    isActive: true,
    isFallback: true,
    project: project(FALLBACK_PROJECT),
    problem: null,
    updatedAt: VERSION_FALLBACK,
  }
  const rules = billing
    ? [fallback, {
        id: BILLING_RULE,
        categoryValue: 'billing',
        isActive: true,
        isFallback: false,
        project: project(billing.projectId),
        problem: null,
        updatedAt: billing.version,
      }]
    : [fallback]
  return {
    fallback: { ruleId: FALLBACK_RULE, project: project(FALLBACK_PROJECT), updatedAt: VERSION_FALLBACK },
    rules,
    categories: [{ value: 'billing', label: 'Billing', route: null }],
    unnotifiedTicketCount: 0,
  }
}

let previews: ReturnType<typeof snapshot>[] = []

function renderTab() {
  return render(
    <SupportSettingsTab
      context={{
        moduleId: 'staff',
        canManage: true,
        settings: {} as never,
        onSettingsSaved: jest.fn(),
      }}
    />,
  )
}

async function openEditDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.getByRole('dialog')
}

function conflictError() {
  return Object.assign(new Error('conflict'), { status: 409, body: { code: 'optimistic_lock_conflict' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  previews = []
  mockReadApiResult.mockImplementation(async (url: unknown) => {
    if (String(url) === PREVIEW_URL) return (previews.length > 1 ? previews.shift() : previews[0]) as never
    return { items: [] } as never
  })
  mockSurfaceConflict.mockImplementation(() => false)
})

describe('support routing settings optimistic lock', () => {
  it('reads rule versions from the preview snapshot instead of a separate request', async () => {
    previews = [snapshot({ projectId: PROJECT_X, version: VERSION_X })]
    renderTab()
    await screen.findByRole('button', { name: 'Edit' })

    const versionFetches = mockApiCall.mock.calls.filter(([url]) => String(url).includes('support-routing-rules?ids='))
    expect(versionFetches).toHaveLength(0)
  })

  it('toggles a rule with the token of the snapshot it displays', async () => {
    previews = [snapshot({ projectId: PROJECT_X, version: VERSION_X })]
    renderTab()
    fireEvent.click(await screen.findByRole('switch', { name: 'Active' }))

    await waitFor(() => expect(mockUpdateCrud).toHaveBeenCalledTimes(1))
    const [, body, options] = mockUpdateCrud.mock.calls[0]
    expect(body).toEqual({ id: BILLING_RULE, isActive: false })
    expect(options?.headers).toEqual(buildOptimisticLockHeader(VERSION_X))
  })

  it('rebases an open edit dialog onto the refreshed values and token after a conflict', async () => {
    previews = [
      snapshot({ projectId: PROJECT_X, version: VERSION_X }),
      snapshot({ projectId: PROJECT_Y, version: VERSION_Y }),
    ]
    mockUpdateCrud.mockRejectedValueOnce(conflictError())
    mockSurfaceConflict.mockImplementationOnce((_err, _t, options) => {
      options?.onRefresh?.()
      return true
    })
    renderTab()

    const dialog = await openEditDialog()
    fireEvent.change(within(dialog).getByLabelText('project'), { target: { value: PROJECT_Z } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdateCrud).toHaveBeenCalledTimes(1))
    expect(mockUpdateCrud.mock.calls[0][1]).toEqual({ id: BILLING_RULE, timeProjectId: PROJECT_Z })
    expect(mockUpdateCrud.mock.calls[0][2]?.headers).toEqual(buildOptimisticLockHeader(VERSION_X))

    await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('project')).toHaveValue(PROJECT_Y))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdateCrud).toHaveBeenCalledTimes(2))
    expect(mockUpdateCrud.mock.calls[1][1]).toEqual({ id: BILLING_RULE, timeProjectId: PROJECT_Y })
    expect(mockUpdateCrud.mock.calls[1][2]?.headers).toEqual(buildOptimisticLockHeader(VERSION_Y))
  })

  it('closes the edit dialog when a refresh shows the rule was deleted', async () => {
    previews = [
      snapshot({ projectId: PROJECT_X, version: VERSION_X }),
      snapshot(null),
    ]
    mockUpdateCrud.mockRejectedValueOnce(conflictError())
    mockSurfaceConflict.mockImplementationOnce((_err, _t, options) => {
      options?.onRefresh?.()
      return true
    })
    renderTab()

    const dialog = await openEditDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
