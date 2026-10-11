/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import insightsEn from '../../../i18n/en.json'
import authEn from '../../../../auth/i18n/en.json'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockRunMutation = jest.fn((input: { operation: () => Promise<unknown> }) => input.operation().then((result) => ({ result })))
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/roles/x/edit',
  useSearchParams: () => new URLSearchParams(),
}))

import RoleAclSimulateWidget from '../../../widgets/injection/role-acl-simulate/widget.client'
import RoleAclSimulationApplyWidget from '../../../widgets/injection/role-acl-simulation-apply/widget.client'
import roleAclSimulateModule from '../../../widgets/injection/role-acl-simulate/widget'
import roleAclSimulationApplyModule from '../../../widgets/injection/role-acl-simulation-apply/widget'
import { SimulationRunPageClient } from '../SimulationRunPage.client'
import { readPendingSimulationDecision, rememberPendingSimulationRun, resetPendingSimulationRuns } from '../../../lib/client/simulation/pendingDecisions'
import { buildRoleAclProposal, describeRoleAclGroup, roleAclProposalToValues } from '../../../lib/client/simulation/roleAclPreview'

const DICT = { ...insightsEn, ...authEn } as Record<string, string>
const RUN_ID = 'aaaaaaaa-0000-4000-8000-000000000007'
const ROLE_ID = 'bbbbbbbb-0000-4000-8000-000000000007'
const ORG_A = 'cccccccc-0000-4000-8000-0000000000a7'
const ORG_B = 'cccccccc-0000-4000-8000-0000000000b7'
const USER_ID = 'dddddddd-0000-4000-8000-000000000007'
const FORM_ID = `auth.role.acl:${ROLE_ID}`
const CELLS = ['gains', 'loses', 'gains_and_loses', 'unchanged']

const EDITOR_DATA = {
  roleId: ROLE_ID,
  tenantId: null,
  isSuperAdmin: false,
  features: ['sales.orders.view'],
  organizations: null,
  updatedAt: '2026-10-01T10:00:00.000Z',
}

function ok(result: unknown, status = 200) {
  return { ok: true, status, result, response: {} as Response, cacheStatus: null }
}

function failed(status: number, result: unknown) {
  return { ok: false, status, result, response: {} as Response, cacheStatus: null }
}

const CAPABILITIES = {
  canRun: true,
  kinds: [{ kind: 'auth.role_acl_preview', artifactKind: 'auth.role_acl', labelKey: 'auth.simulation.kind.roleAclPreview', cellKeys: CELLS, execution: 'inline' }],
  limits: { defaultWindowDays: 90, maxWindowDays: 365, maxRecords: 50000, maxDurationMs: 120000 },
}

function cell(key: string, count: number | null, extra: Record<string, unknown> = {}) {
  return { key, count, suppressed: null, samples: [], ...extra }
}

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    kind: 'auth.role_acl_preview',
    kindLabelKey: 'auth.simulation.kind.roleAclPreview',
    status: 'completed',
    execution: 'inline',
    hasLiveRecords: true,
    artifactKind: 'auth.role_acl',
    artifactId: ROLE_ID,
    progressJobId: null,
    fidelity: 'observed',
    errorCode: null,
    windowFrom: '2026-10-10T12:00:00.000Z',
    windowTo: '2026-10-10T12:00:00.000Z',
    createdAt: '2026-10-10T12:00:00.000Z',
    startedAt: '2026-10-10T12:00:00.000Z',
    completedAt: '2026-10-10T12:00:01.000Z',
    expiresAt: '2026-10-11T12:00:01.000Z',
    cellKeys: CELLS,
    proposal: { roleId: ROLE_ID, isSuperAdmin: false, features: ['sales.orders.view', 'sales.orders.manage'], organizations: null },
    result: {
      k: 10,
      truncated: false,
      groups: [
        { key: `${ORG_A}:users`, labelKey: 'auth.simulation.groups.users', sampleResourceKind: null, total: 12, suppressed: false, cells: [cell('gains', 12), cell('loses', 0), cell('gains_and_loses', 0), cell('unchanged', 0)], warnings: [], flags: [] },
        { key: `${ORG_B}:users`, labelKey: 'auth.simulation.groups.users', sampleResourceKind: null, total: null, suppressed: true, cells: CELLS.map((key) => cell(key, null, { suppressed: 'below_k' })), warnings: [], flags: [] },
      ],
      summary: {
        warnings: ['auth.simulation.warnings.selfLockoutAclManage'],
        counts: { organizations_evaluated: 2, pages_lost: 3 },
        lists: { features_gained: ['sales.orders.manage'], features_lost: [] },
      },
    },
    coverage: {},
    caveats: ['auth.simulation.caveats.currentState'],
    budgets: { maxRecords: 50000, maxDurationMs: 120000, recordsUsed: 13, elapsedMs: 40 },
    decisions: [],
    applyHref: `/backend/roles/${ROLE_ID}/edit?simulationRunId=${RUN_ID}`,
    canDecide: true,
    ...overrides,
  }
}

const RECORDS = {
  ok: true,
  items: [
    { id: USER_ID, type: 'user', label: 'Ann <ann@example.com>', href: `/backend/users/${USER_ID}/edit`, groupKeys: [`${ORG_A}:users`], counts: { organizations: 1, features_gained: 1, features_lost: 0 } },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  notes: [],
  groupLabels: { [`${ORG_A}:users`]: 'Alpha', [`${ORG_B}:users`]: 'Beta' },
}

function routeReads(run: Record<string, unknown>, records: Record<string, unknown> = RECORDS) {
  mockApiCall.mockImplementation((input: unknown, init?: { method?: string }) => {
    const url = String(input)
    if (url.endsWith('/capabilities')) return Promise.resolve(ok(CAPABILITIES))
    if (url.endsWith('/decision') && init?.method === 'POST') return Promise.resolve(ok({ ok: true }, 201))
    if (url.includes(`/api/insights/simulations/${RUN_ID}/records`)) return Promise.resolve(ok(records))
    if (url.includes(`/api/insights/simulations/${RUN_ID}`)) return Promise.resolve(ok({ ok: true, result: run }))
    return Promise.resolve(failed(404, { error: 'missing', code: 'run_not_found' }))
  })
}

function renderUi(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: DICT })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetPendingSimulationRuns()
  window.history.replaceState(null, '', `/backend/roles/${ROLE_ID}/edit`)
})

describe('role ACL simulate widget', () => {
  it('is gated on insights.simulator.run on the role ACL editor spots', () => {
    expect(roleAclSimulateModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(roleAclSimulateModule.metadata.requiredModules).toEqual(['auth'])
    expect(roleAclSimulationApplyModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(typeof roleAclSimulationApplyModule.eventHandlers?.onAfterSave).toBe('function')
  })

  it('stays hidden when the viewer may not run the permission preview', async () => {
    mockApiCall.mockResolvedValue(ok({ ...CAPABILITIES, kinds: [] }))
    renderUi(<RoleAclSimulateWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.queryByTestId('role-acl-simulate-open')).toBeNull()
  })

  it('previews the CURRENT unsaved ACL inline (no history window) and shows the warning, counts, organizations and affected users', async () => {
    routeReads(runDetail())
    mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'completed', deduplicated: false })
    const view = renderUi(<RoleAclSimulateWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} />)
    fireEvent.click(await screen.findByTestId('role-acl-simulate-open'))
    expect(screen.getByText(DICT['insights.simulation.ui.roleAclSimulate.title'])).toBeTruthy()
    expect(screen.getByTestId('simulation-request-inline-help')).toBeTruthy()
    expect(screen.queryByText(DICT['insights.simulation.ui.simulate.window'])).toBeNull()
    view.rerender(<RoleAclSimulateWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={{ ...EDITOR_DATA, features: ['sales.orders.view', 'sales.orders.manage'] }} />)
    fireEvent.keyDown(await screen.findByTestId('simulation-request-dialog'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
    const [url, init] = mockApiCallOrThrow.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('/api/insights/simulations')
    expect(JSON.parse(init.body)).toEqual({
      kind: 'auth.role_acl_preview',
      artifactId: ROLE_ID,
      proposal: { roleId: ROLE_ID, isSuperAdmin: false, features: ['sales.orders.view', 'sales.orders.manage'], organizations: null },
    })
    const result = await screen.findByTestId('simulation-request-result')
    const warnings = within(result).getByTestId('simulation-summary-warnings')
    expect(warnings.textContent).toContain(DICT['auth.simulation.warnings.selfLockoutAclManage'])
    expect(within(result).getByText(DICT['auth.simulation.summary.pages_lost'])).toBeTruthy()
    expect(within(result).getByText('sales.orders.manage')).toBeTruthy()
    const headlines = await within(result).findAllByTestId('simulation-group-headline')
    await waitFor(() => expect(within(headlines[0]).getByText('Alpha')).toBeTruthy())
    expect(within(headlines[0]).getByText(DICT['auth.simulation.groups.users'])).toBeTruthy()
    expect(within(headlines[0]).getByText('12 with access in this organization')).toBeTruthy()
    expect(within(headlines[1]).getByText('Fewer than 10 — hidden to protect small groups')).toBeTruthy()
    const records = within(result).getByTestId('simulation-live-records')
    expect(await within(records).findByText('Ann <ann@example.com>')).toBeTruthy()
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/records?page=1&pageSize=10`, expect.anything())
    expect(within(result).getByText(DICT['insights.simulation.ui.roleAclSimulate.decisionHint'])).toBeTruthy()
    expect(readPendingSimulationDecision(FORM_ID, ROLE_ID)).toEqual({ runId: RUN_ID, recordId: ROLE_ID, source: 'dialog' })
  })

  it('shows the access-log and forbidden refusals', async () => {
    routeReads(runDetail())
    mockApiCallOrThrow.mockRejectedValueOnce(Object.assign(new Error('refused'), { status: 503, code: 'access_log_unavailable', error: 'refused' }))
    renderUi(<RoleAclSimulateWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} />)
    fireEvent.click(await screen.findByTestId('role-acl-simulate-open'))
    fireEvent.click(await screen.findByTestId('simulation-request-submit'))
    expect((await screen.findByTestId('simulation-request-error')).textContent).toContain(DICT['insights.simulation.errors.access_log_unavailable'])
  })
})

describe('role ACL simulation apply widget', () => {
  it('records the applied decision after the role save, flashing the role wording on failure', async () => {
    rememberPendingSimulationRun(FORM_ID, { runId: RUN_ID, recordId: ROLE_ID, source: 'dialog' })
    renderUi(<RoleAclSimulationApplyWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} />)
    const banner = await screen.findByTestId('role-acl-simulation-apply')
    expect(banner.textContent).toContain(DICT['insights.simulation.ui.roleAclApply.description'])
    mockApiCall.mockResolvedValue(failed(500, { error: 'boom' }))
    await act(async () => {
      await roleAclSimulationApplyModule.eventHandlers!.onAfterSave!(EDITOR_DATA, { formId: FORM_ID, recordId: ROLE_ID })
    })
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/decision`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'applied' }) }))
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.roleAclApply.decisionFailed'], 'warning')
    expect(readPendingSimulationDecision(FORM_ID, ROLE_ID)).toBeNull()
  })

  it('loads the simulated permissions of a linked run of this role into the editor', async () => {
    window.history.replaceState(null, '', `/backend/roles/${ROLE_ID}/edit?simulationRunId=${RUN_ID}`)
    routeReads(runDetail())
    const onDataChange = jest.fn()
    renderUi(<RoleAclSimulationApplyWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('role-acl-simulation-load-proposal'))
    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
    expect(onDataChange.mock.calls[0][0]).toEqual({ ...EDITOR_DATA, features: ['sales.orders.view', 'sales.orders.manage'] })
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.roleAclApply.loaded'], 'success')
  })

  it('refuses to load a run of another role', async () => {
    window.history.replaceState(null, '', `/backend/roles/${ROLE_ID}/edit?simulationRunId=${RUN_ID}`)
    routeReads(runDetail({ artifactId: 'eeeeeeee-0000-4000-8000-000000000007', proposal: { roleId: 'eeeeeeee-0000-4000-8000-000000000007', isSuperAdmin: false, features: [], organizations: null } }))
    const onDataChange = jest.fn()
    renderUi(<RoleAclSimulationApplyWidget context={{ formId: FORM_ID, recordId: ROLE_ID }} data={EDITOR_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('role-acl-simulation-load-proposal'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.apply.loadFailed'], 'error'))
    expect(onDataChange).not.toHaveBeenCalled()
  })
})

describe('role permission preview result page', () => {
  it('shows when it was computed (no history window, no fidelity), the summary, organization headings and the live, paged affected list', async () => {
    const records = { ...RECORDS, total: 60, totalPages: 2, pageSize: 50, notes: ['auth.simulation.records.proposalInEffect'] }
    routeReads(runDetail(), records)
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    const page = await screen.findByTestId('simulation-run-page')
    expect(page.textContent).toContain('Computed from the live configuration at')
    expect(screen.queryByTestId('simulation-fidelity')).toBeNull()
    const result = screen.getByTestId('simulation-result')
    expect(within(result).getByRole('heading', { level: 2 }).textContent).toBe(DICT['auth.simulation.result.title'])
    expect(result.textContent).not.toContain(DICT['insights.simulation.ui.result.title'])
    expect(screen.getByTestId('simulation-summary-warnings').textContent).toContain(DICT['auth.simulation.warnings.selfLockoutAclManage'])
    const groups = await screen.findAllByTestId('simulation-group')
    await waitFor(() => expect(within(groups[0]).getByText('Alpha')).toBeTruthy())
    expect(within(groups[1]).getByText('Beta')).toBeTruthy()
    expect(within(groups[0]).getByText(DICT['auth.simulation.cells.gains'])).toBeTruthy()
    const list = screen.getByTestId('simulation-live-records')
    const link = await within(list).findByTestId('simulation-record-link')
    expect(link.getAttribute('href')).toBe(`/backend/users/${USER_ID}/edit`)
    expect(within(list).getByText(DICT['auth.simulation.records.types.user'])).toBeTruthy()
    expect(within(list).getByText(DICT['auth.simulation.records.counts.features_gained'])).toBeTruthy()
    expect(within(list).getByTestId('simulation-live-records-notes').textContent).toContain(DICT['auth.simulation.records.proposalInEffect'])
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/records?page=1&pageSize=50`, expect.anything())
    expect(screen.getByTestId('simulation-apply').getAttribute('href')).toBe(`/backend/roles/${ROLE_ID}/edit?simulationRunId=${RUN_ID}`)
  })

  it('does not list records of a kind without live records', async () => {
    routeReads(runDetail({ hasLiveRecords: false }))
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    await screen.findByTestId('simulation-run-page')
    expect(screen.queryByTestId('simulation-live-records')).toBeNull()
    expect(mockApiCall.mock.calls.some((call) => String(call[0]).includes('/records'))).toBe(false)
  })
})

describe('role permission preview client helpers', () => {
  it('build the proposal from editor data, read it back for the same role only and parse group keys', () => {
    expect(buildRoleAclProposal({ roleId: ROLE_ID, isSuperAdmin: 'yes', features: ['a', 3], organizations: 'all' })).toEqual({ roleId: ROLE_ID, isSuperAdmin: false, features: ['a'], organizations: null })
    expect(roleAclProposalToValues({ roleId: ROLE_ID, isSuperAdmin: true, features: ['a'], organizations: [] }, ROLE_ID)).toEqual({ isSuperAdmin: true, features: ['a'], organizations: [] })
    expect(roleAclProposalToValues({ roleId: ROLE_ID, isSuperAdmin: true, features: ['a'], organizations: [] }, USER_ID)).toBeNull()
    expect(roleAclProposalToValues({ ruleId: 'x' })).toBeNull()
    expect(describeRoleAclGroup(`${ORG_A}:api_keys`)).toEqual({ organizationId: ORG_A, principalType: 'api_keys' })
    expect(describeRoleAclGroup('other')).toEqual({ organizationId: null, principalType: null })
  })
})
