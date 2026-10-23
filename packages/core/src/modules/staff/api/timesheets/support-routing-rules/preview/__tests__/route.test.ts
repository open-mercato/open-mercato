/** @jest-environment node */
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const FALLBACK_PROJECT = '44444444-4444-4444-8444-444444444441'
const BILLING_PROJECT = '44444444-4444-4444-8444-444444444442'
const FALLBACK_RULE = '55555555-5555-4555-8555-555555555551'
const BILLING_RULE = '55555555-5555-4555-8555-555555555552'

const mockReaches = jest.fn()
const mockGraceDays = jest.fn()
const kyselyWheres: [string, string, unknown][] = []
let unnotifiedRows: { time_project_id: string; ticket_count: string | number }[] = []

const projects = [
  { id: FALLBACK_PROJECT, name: 'Customer support', code: 'CS', status: 'active', deletedAt: null, ownerUserId: null, defaultAssigneeStaffMemberId: null },
  { id: BILLING_PROJECT, name: 'Billing', code: 'BIL', status: 'active', deletedAt: null, ownerUserId: 'owner-1', defaultAssigneeStaffMemberId: null },
]

function kyselyBuilder() {
  const builder = {
    innerJoin: () => builder,
    select: () => builder,
    groupBy: () => builder,
    where: (column: string, operator: string, value: unknown) => {
      kyselyWheres.push([column, operator, value])
      return builder
    },
    execute: async () => unnotifiedRows,
  }
  return builder
}

const em: Record<string, unknown> = {
  find: jest.fn(async () => projects),
  getKysely: () => ({ selectFrom: () => kyselyBuilder() }),
}
em.fork = () => em

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: (name: string) => (name === 'em' ? em : undefined) })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ tenantId: TENANT_ID, selectedId: ORG_ID })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key })),
}))

jest.mock('../../../../../lib/support/dictionaries', () => ({
  loadSupportTicketCategories: jest.fn(async () => [{ value: 'billing', label: 'Billing' }]),
}))

jest.mock('../../../../../lib/support/routing', () => ({
  loadSupportRoutingRules: jest.fn(async () => [
    { id: FALLBACK_RULE, categoryValue: null, timeProjectId: FALLBACK_PROJECT, isActive: true, updatedAt: new Date('2026-05-01T10:00:00.000Z') },
    { id: BILLING_RULE, categoryValue: 'billing', timeProjectId: BILLING_PROJECT, isActive: true, updatedAt: new Date('2026-05-02T11:30:00.000Z') },
  ]),
  loadUsableSupportProjectIds: jest.fn(async () => new Set([FALLBACK_PROJECT, BILLING_PROJECT])),
  resolveSupportRouteFromRules: jest.fn(() => ({ via: 'category', timeProjectId: BILLING_PROJECT })),
}))

jest.mock('../../../../../lib/time-tracking/projectAssignment', () => ({
  resolveAssignmentGraceDaysFromContainer: (...args: unknown[]) => mockGraceDays(...args),
}))

jest.mock('../../../../../lib/time-tracking/workRecipients', () => ({
  projectReachesRecipientBeforeManagers: (...args: unknown[]) => mockReaches(...args),
}))

import { GET } from '../route'

type ProjectView = { id: string; nobodyNotified?: boolean; unnotifiedTicketCount?: number }
type PreviewBody = {
  fallback: { ruleId: string; project: ProjectView; updatedAt?: string | null } | null
  rules: { id: string; project: ProjectView; updatedAt?: string | null }[]
  categories: { route: { project: ProjectView } | null }[]
  unnotifiedTicketCount?: number
}

beforeEach(() => {
  jest.clearAllMocks()
  kyselyWheres.length = 0
  unnotifiedRows = []
  mockGraceDays.mockResolvedValue(2)
  mockReaches.mockImplementation(async (_em: unknown, _scope: unknown, project: { id: string }) => project.id !== FALLBACK_PROJECT)
})

async function preview(): Promise<PreviewBody> {
  const response = await GET(new Request('http://localhost/api/staff/timesheets/support-routing-rules/preview'))
  expect(response.status).toBe(200)
  return (await response.json()) as PreviewBody
}

describe('GET /api/staff/timesheets/support-routing-rules/preview', () => {
  it('flags a routing target that would notify nobody before the project managers', async () => {
    const body = await preview()

    expect(body.fallback?.project).toEqual(expect.objectContaining({ id: FALLBACK_PROJECT, nobodyNotified: true }))
    const billing = body.rules.find((rule) => rule.id === BILLING_RULE)
    expect(billing?.project).toEqual(expect.objectContaining({ id: BILLING_PROJECT, nobodyNotified: false }))
    expect(mockReaches).toHaveBeenCalledWith(
      em,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      expect.objectContaining({ id: FALLBACK_PROJECT }),
      { graceDays: 2 },
    )
  })

  it('counts tickets not notified to anyone, per project and for the organization', async () => {
    unnotifiedRows = [
      { time_project_id: FALLBACK_PROJECT, ticket_count: '3' },
      { time_project_id: BILLING_PROJECT, ticket_count: 1 },
    ]

    const body = await preview()

    expect(body.unnotifiedTicketCount).toBe(4)
    expect(body.fallback?.project.unnotifiedTicketCount).toBe(3)
    expect(body.categories[0].route?.project.unnotifiedTicketCount).toBe(1)
    expect(kyselyWheres).toEqual(expect.arrayContaining([
      ['staff_support_tickets.tenant_id', '=', TENANT_ID],
      ['staff_support_tickets.organization_id', '=', ORG_ID],
      ['staff_support_tickets.unnotified_at', 'is not', null],
      ['staff_support_tickets.deleted_at', 'is', null],
      ['staff_time_tasks.deleted_at', 'is', null],
      ['staff_time_tasks.source', '=', 'portal'],
    ]))
  })

  it('reports zero when every ticket reached somebody', async () => {
    const body = await preview()
    expect(body.unnotifiedTicketCount).toBe(0)
    expect(body.fallback?.project.unnotifiedTicketCount).toBe(0)
  })

  it('returns each rule version token in the same snapshot as its editable values', async () => {
    const body = await preview()

    expect(body.fallback).toEqual(expect.objectContaining({
      ruleId: FALLBACK_RULE,
      updatedAt: '2026-05-01T10:00:00.000Z',
    }))
    expect(body.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: FALLBACK_RULE, updatedAt: '2026-05-01T10:00:00.000Z' }),
      expect.objectContaining({
        id: BILLING_RULE,
        updatedAt: '2026-05-02T11:30:00.000Z',
        project: expect.objectContaining({ id: BILLING_PROJECT }),
      }),
    ]))
  })
})
