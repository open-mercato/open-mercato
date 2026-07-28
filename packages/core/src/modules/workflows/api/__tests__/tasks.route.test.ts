/**
 * User Tasks list API tests.
 *
 * The inbox sends `myTasks=true` by default, so the narrowing the handler
 * applies for that flag is what makes the "My Tasks" view true: a caller must
 * see the tasks assigned to them personally plus the ones queued to a role they
 * hold, and nothing else.
 */

import { NextRequest } from 'next/server'
import { GET as listTasks } from '../tasks/route'
import { UserTask } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

type WhereClause = Record<string, unknown>

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const USER_ID = 'user-1'

describe('GET /api/workflows/tasks', () => {
  let mockEm: { findAndCount: jest.Mock }

  function setAuthRoles(roles: string[] | undefined) {
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      ...(roles ? { roles } : {}),
    })
  }

  async function runList(query: string): Promise<WhereClause> {
    await listTasks(new NextRequest(`http://localhost/api/workflows/tasks${query}`))
    return mockEm.findAndCount.mock.calls[0][1] as WhereClause
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = { findAndCount: jest.fn().mockResolvedValue([[], 0]) }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? mockEm : null),
    })

    setAuthRoles(['warehouse'])

    const {
      resolveOrganizationScopeForRequest,
    } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: ORG_ID })
  })

  test('scopes every listing to the caller tenant and organization', async () => {
    const where = await runList('')

    expect(mockEm.findAndCount).toHaveBeenCalledWith(UserTask, expect.any(Object), expect.any(Object))
    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: [ORG_ID] } })
  })

  test('narrows to the caller as assignee or as a holder of the queued role when myTasks is set', async () => {
    const where = await runList('?myTasks=true')

    expect(where.$or).toEqual([
      { assignedTo: USER_ID },
      { assignedToRoles: { $overlap: ['warehouse'] } },
    ])
  })

  test('matches nothing by role for a caller holding no roles', async () => {
    setAuthRoles(undefined)

    const where = await runList('?myTasks=true')

    expect(where.$or).toEqual([{ assignedTo: USER_ID }, { assignedToRoles: { $overlap: [] } }])
  })

  test('leaves the listing unnarrowed when myTasks is absent', async () => {
    const where = await runList('?status=PENDING')

    expect(where.$or).toBeUndefined()
    expect(where.status).toBe('PENDING')
  })
})
