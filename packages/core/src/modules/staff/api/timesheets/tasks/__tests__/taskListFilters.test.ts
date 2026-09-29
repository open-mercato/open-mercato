/** @jest-environment node */
// R3 pinned: a task query that is not intersected with `resolveProjectAccess` hands a
// non-member another client's task titles. Every branch of the list filter is
// exercised here, including the "asked for one id" path the drawer uses.
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('../../../../lib/time-tracking/access', () => ({
  resolveProjectAccess: jest.fn(),
}))

import { buildTaskListFilters } from '../route'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'

const mockResolveProjectAccess = resolveProjectAccess as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const FOREIGN_PROJECT_ID = '44444444-4444-4444-8444-4444444444ff'
const TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
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

const run = (query: QueryInput) => buildTaskListFilters(query as never, ctxFor())

beforeEach(() => {
  jest.clearAllMocks()
})

describe('buildTaskListFilters — project access', () => {
  it('narrows a member to the projects they are assigned to', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({})).resolves.toEqual({ time_project_id: { $in: [MEMBER_PROJECT_ID] } })
  })

  it('gives a non-member nothing from the list', async () => {
    asMember([])

    await expect(run({})).resolves.toEqual({ time_project_id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('gives a non-member nothing when they ask for one id', async () => {
    asMember([])

    await expect(run({ id: TASK_ID })).resolves.toEqual({ time_project_id: { $in: [IMPOSSIBLE_ID] } })
    await expect(run({ ids: TASK_ID })).resolves.toEqual({ time_project_id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('refuses a project the member is not assigned to, even when named explicitly', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({ timeProjectId: FOREIGN_PROJECT_ID })).resolves.toEqual({
      time_project_id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('keeps a requested project when the member is assigned to it', async () => {
    asMember([MEMBER_PROJECT_ID, FOREIGN_PROJECT_ID])

    await expect(run({ timeProjectId: MEMBER_PROJECT_ID })).resolves.toEqual({
      time_project_id: { $in: [MEMBER_PROJECT_ID] },
    })
  })

  it('leaves a manager unnarrowed but still honours an explicit project', async () => {
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

    await run({ q: 'koszyk' })

    expect(mockResolveProjectAccess).toHaveBeenCalledTimes(1)
  })
})

describe('buildTaskListFilters — board and drawer filters', () => {
  beforeEach(() => {
    asManager()
  })

  it('excludes children when the board asks for top-level only', async () => {
    await expect(run({ topLevelOnly: 'true' })).resolves.toEqual({ parent_task_id: { $eq: null } })
  })

  it('does not filter by parent unless asked', async () => {
    await expect(run({ topLevelOnly: 'false' })).resolves.toEqual({})
  })

  it('returns one parent checklist when a parent is named', async () => {
    await expect(run({ parentTaskId: TASK_ID, topLevelOnly: 'true' })).resolves.toEqual({
      parent_task_id: TASK_ID,
    })
  })

  it('filters by column, assignee and title search', async () => {
    const filters = await run({
      taskStatusId: 'aaaaaaaa-0000-4000-8000-000000000002',
      assigneeStaffMemberId: '66666666-6666-4666-8666-666666666666',
      q: 'koszyk',
    })

    expect(filters).toEqual({
      task_status_id: 'aaaaaaaa-0000-4000-8000-000000000002',
      assignee_staff_member_id: '66666666-6666-4666-8666-666666666666',
      title: { $ilike: '%koszyk%' },
    })
  })

  it('intersects an id list with the project narrowing', async () => {
    asMember([MEMBER_PROJECT_ID])

    await expect(run({ ids: `${TASK_ID}, ${IMPOSSIBLE_ID}` })).resolves.toEqual({
      time_project_id: { $in: [MEMBER_PROJECT_ID] },
      id: { $in: [TASK_ID, IMPOSSIBLE_ID] },
    })
  })
})

/**
 * W9 — the board's tag chips used to filter loaded rows only, so a match on page two
 * was invisible. The server filter must mean exactly what the chips mean: every
 * selected tag, not any of them.
 */
describe('buildTaskListFilters — tag filter (W9)', () => {
  const TAG_A = 'cccccccc-0000-4000-8000-00000000000a'
  const TAG_B = 'cccccccc-0000-4000-8000-00000000000b'
  const TASK_A = 'bbbbbbbb-0000-4000-8000-00000000000a'
  const TASK_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

  type TagRow = { taskId: string; tagId: string }

  function ctxWithTagRows(rows: TagRow[] | Error): CrudCtx {
    const find = jest.fn(async () => {
      if (rows instanceof Error) throw rows
      return rows
    })
    return {
      auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
      container: {
        resolve: (name: string) => {
          if (name === 'em') return { fork: () => ({ find }) }
          throw new Error(`[internal] unexpected resolve ${name}`)
        },
      },
      __find: find,
    } as unknown as CrudCtx
  }

  const runWithTags = (query: QueryInput, rows: TagRow[] | Error) =>
    buildTaskListFilters(query as never, ctxWithTagRows(rows))

  beforeEach(() => {
    asManager()
  })

  it('keeps only tasks carrying every selected tag', async () => {
    const rows = [
      { taskId: TASK_A, tagId: TAG_A },
      { taskId: TASK_A, tagId: TAG_B },
      { taskId: TASK_B, tagId: TAG_A },
    ]

    await expect(runWithTags({ tagIds: `${TAG_A},${TAG_B}` }, rows)).resolves.toEqual({
      id: { $in: [TASK_A] },
    })
  })

  it('matches every task carrying the single selected tag', async () => {
    const rows = [
      { taskId: TASK_A, tagId: TAG_A },
      { taskId: TASK_B, tagId: TAG_A },
    ]

    await expect(runWithTags({ tagIds: TAG_A }, rows)).resolves.toEqual({
      id: { $in: [TASK_A, TASK_B] },
    })
  })

  it('narrows to nothing when no task carries the combination', async () => {
    await expect(runWithTags({ tagIds: `${TAG_A},${TAG_B}` }, [])).resolves.toEqual({
      id: { $in: [IMPOSSIBLE_ID] },
    })
  })

  it('narrows to nothing rather than widening when the lookup fails', async () => {
    await expect(
      runWithTags({ tagIds: TAG_A }, new Error('[internal] db down')),
    ).resolves.toEqual({ id: { $in: [IMPOSSIBLE_ID] } })
  })

  it('scopes the tag lookup to the caller tenant and organization', async () => {
    const ctx = ctxWithTagRows([{ taskId: TASK_A, tagId: TAG_A }])
    await buildTaskListFilters({ tagIds: TAG_A } as never, ctx)

    const find = (ctx as unknown as { __find: jest.Mock }).__find
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0][1]).toEqual({
      tagId: { $in: [TAG_A] },
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('intersects the tag filter with an explicit id list', async () => {
    const rows = [
      { taskId: TASK_A, tagId: TAG_A },
      { taskId: TASK_B, tagId: TAG_A },
    ]

    await expect(runWithTags({ tagIds: TAG_A, ids: TASK_B }, rows)).resolves.toEqual({
      id: { $in: [TASK_B] },
    })
  })

  it('does not query tags when no tag is selected', async () => {
    const ctx = ctxWithTagRows([])
    await buildTaskListFilters({} as never, ctx)

    expect((ctx as unknown as { __find: jest.Mock }).__find).not.toHaveBeenCalled()
  })
})
