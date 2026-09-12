/** @jest-environment node */
// C1 pinned: `staff.timesheets.tasks.view` is granted to every employee, so a column
// query that is not intersected with `resolveProjectAccess` hands a Team Member the
// board configuration — names, colours, done/default policy — of every project in the
// organization, including the ones they are not a member of.
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('../../../../lib/time-tracking/access', () => ({
  resolveProjectAccess: jest.fn(),
}))

import { buildTaskStatusListFilters } from '../route'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'

const mockResolveProjectAccess = resolveProjectAccess as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const FOREIGN_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const STATUS_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER_STATUS_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

type QueryInput = Record<string, unknown>

function ctxFor(): CrudCtx {
  return {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => ({}) }
        // rbacService and moduleConfigService are intentionally unavailable: both
        // lookups must degrade rather than throw.
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    },
  } as unknown as CrudCtx
}

function asMember(projectIds: string[]) {
  mockResolveProjectAccess.mockResolvedValue({ canManageAll: false, projectIds, staffMemberId: 'member-1' })
}

function asManager() {
  mockResolveProjectAccess.mockResolvedValue({ canManageAll: true, projectIds: [], staffMemberId: 'member-1' })
}

const run = (query: QueryInput) => buildTaskStatusListFilters(query as never, ctxFor())

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildTaskStatusListFilters — project access', () => {
  it('narrows a member to the boards of the projects they are assigned to', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({})).resolves.toEqual({ time_project_id: { $in: [MEMBER_PROJECT_ID] } })
  })

  it('keeps every assigned project when no board is named', async () => {
    asMember([MEMBER_PROJECT_ID, FOREIGN_PROJECT_ID])

    await expect(run({})).resolves.toEqual({
      time_project_id: { $in: [MEMBER_PROJECT_ID, FOREIGN_PROJECT_ID] },
    })
  })

  it('gives a non-member no column at all', async () => {
    asMember([])

    await expect(run({})).resolves.toEqual({ time_project_id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('refuses another project board, even when named explicitly', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({ timeProjectId: FOREIGN_PROJECT_ID })).resolves.toEqual({
      time_project_id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('refuses another project board when the caller is a member of nothing', async () => {
    asMember([])

    await expect(run({ timeProjectId: FOREIGN_PROJECT_ID })).resolves.toEqual({
      time_project_id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('keeps a requested board when the member is assigned to it', async () => {
    asMember([MEMBER_PROJECT_ID, FOREIGN_PROJECT_ID])

    await expect(run({ timeProjectId: MEMBER_PROJECT_ID })).resolves.toEqual({
      time_project_id: { $in: [MEMBER_PROJECT_ID] },
    })
  })

  it('leaves a manager unnarrowed but still honours an explicit board', async () => {
    asManager()

    await expect(run({})).resolves.toEqual({})
    await expect(run({ timeProjectId: FOREIGN_PROJECT_ID })).resolves.toEqual({
      time_project_id: FOREIGN_PROJECT_ID,
    })
  })

  it('fails closed when the access decision cannot be made', async () => {
    mockResolveProjectAccess.mockRejectedValue(new Error('[internal] rbac down'))

    await expect(run({})).resolves.toEqual({ time_project_id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('resolves the caller access once per query', async () => {
    asMember([MEMBER_PROJECT_ID])

    await run({ timeProjectId: MEMBER_PROJECT_ID })

    expect(mockResolveProjectAccess).toHaveBeenCalledTimes(1)
  })
})

describe('buildTaskStatusListFilters — id narrowing', () => {
  it('keeps the explicit id list for a caller with broad access', async () => {
    asManager()

    await expect(run({ ids: `${STATUS_ID}, ${OTHER_STATUS_ID}` })).resolves.toEqual({
      id: { $in: [STATUS_ID, OTHER_STATUS_ID] },
    })
  })

  it('does not filter by id when none is asked for', async () => {
    asManager()

    await expect(run({ ids: '' })).resolves.toEqual({})
  })

  it('intersects an id list with the project narrowing', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({ ids: STATUS_ID })).resolves.toEqual({
      time_project_id: { $in: [MEMBER_PROJECT_ID] },
      id: { $in: [STATUS_ID] },
    })
  })

  it('answers a non-member nothing even when they name a column id', async () => {
    asMember([])

    await expect(run({ ids: STATUS_ID })).resolves.toEqual({
      time_project_id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('narrows to nothing rather than widening when the id list parses empty', async () => {
    asManager()

    await expect(run({ ids: ' , ' })).resolves.toEqual({ id: { $in: [IMPOSSIBLE_ID] } })
  })
})
