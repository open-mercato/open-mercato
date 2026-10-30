/** @jest-environment node */
// Coverage for T2.12: the employees route gained a PUT so a membership can be
// re-dated in place. The contract pinned here is the one a caller can abuse —
// the project the membership belongs to comes from the URL, never from the
// body, and the write runs on `makeCrudRoute`'s command path, which is what
// wires the mutation-guard registry (and the optimistic-lock header) for us.
import type { CrudCommandActionConfig } from '@open-mercato/shared/lib/crud/factory'

type CapturedCrudOptions = {
  metadata?: Record<string, { requireAuth?: boolean; requireFeatures?: string[] }>
  actions?: {
    create?: CrudCommandActionConfig
    update?: CrudCommandActionConfig
    delete?: CrudCommandActionConfig
  }
}

let capturedCrudOptions: CapturedCrudOptions | null = null
const routeHandlers = {
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: CapturedCrudOptions) => {
    capturedCrudOptions = opts
    return routeHandlers
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const MEMBERSHIP_ID = '77777777-7777-4777-8777-777777777777'
const OTHER_PROJECT_ID = '66666666-6666-4666-8666-666666666666'

const routeUrl = (projectId = PROJECT_ID) =>
  `https://example.test/api/staff/timesheets/time-projects/${projectId}/employees`

type RouteModule = typeof import('../route')

let route: RouteModule

function updateAction(): CrudCommandActionConfig {
  const action = capturedCrudOptions?.actions?.update
  if (!action) throw new Error('[internal] update action missing from makeCrudRoute options')
  return action
}

async function runMapInput(raw: Record<string, unknown>, url = routeUrl()): Promise<Record<string, unknown>> {
  const action = updateAction()
  const ctx = { request: new Request(url, { method: 'PUT' }) } as never
  return (await action.mapInput!({ raw, parsed: raw, ctx })) as Record<string, unknown>
}

describe('staff time project employees PUT (T2.12)', () => {
  beforeAll(async () => {
    route = await import('../route')
  })

  it('exposes PUT behind staff.timesheets.projects.manage', () => {
    expect(route.PUT).toBe(routeHandlers.PUT)
    expect(route.metadata.PUT).toEqual({
      requireAuth: true,
      requireFeatures: ['staff.timesheets.projects.manage'],
    })
    // Viewing the team is a weaker grant and must not carry the write.
    expect(route.metadata.GET.requireFeatures).toEqual(['staff.timesheets.projects.view'])
  })

  it('routes the write through the update command, so guards and audit run', () => {
    expect(updateAction().commandId).toBe('staff.timesheets.time_project_members.update')
    // Assign/unassign stay exactly where they were.
    expect(capturedCrudOptions?.actions?.create?.commandId).toBe('staff.timesheets.time_project_members.assign')
    expect(capturedCrudOptions?.actions?.delete?.commandId).toBe('staff.timesheets.time_project_members.unassign')
  })

  it('takes the project from the URL and ignores a project id smuggled in the body', async () => {
    const input = await runMapInput({
      id: MEMBERSHIP_ID,
      timeProjectId: OTHER_PROJECT_ID,
      assignedEndDate: '2026-12-31',
    })

    expect(input.timeProjectId).toBe(PROJECT_ID)
    expect(input.id).toBe(MEMBERSHIP_ID)
  })

  it('keeps the membership id on the command input so row-level guards can bind to it', async () => {
    const input = await runMapInput({ id: MEMBERSHIP_ID, assignedEndDate: null })
    expect(input.id).toBe(MEMBERSHIP_ID)
    expect(input.assignedEndDate).toBeNull()
  })

  it('accepts the membership id from the query string', async () => {
    const input = await runMapInput({ assignedEndDate: '2026-12-31' }, `${routeUrl()}?id=${MEMBERSHIP_ID}`)
    expect(input.id).toBe(MEMBERSHIP_ID)
  })

  it('rejects a body without a membership id', async () => {
    await expect(runMapInput({ assignedEndDate: '2026-12-31' })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a body whose fields fail validation', async () => {
    await expect(runMapInput({ id: MEMBERSHIP_ID, status: 'archived' })).rejects.toBeTruthy()
    await expect(runMapInput({ id: 'not-a-uuid', assignedEndDate: '2026-12-31' })).rejects.toBeTruthy()
  })

  it('documents PUT in the OpenAPI surface', () => {
    expect(route.openApi.methods?.PUT).toBeTruthy()
    expect(route.openApi.methods?.PUT?.requestBody).toBeTruthy()
  })
})
