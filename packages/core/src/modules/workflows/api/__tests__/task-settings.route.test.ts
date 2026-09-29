/**
 * Tenant task-permission settings route + reader.
 *
 * Four properties are load-bearing and are asserted through the real handlers:
 *
 * 1. The read FAILS TO `true` — the new, narrower model. A broken config must
 *    never silently reopen every task in the tenant.
 * 2. `tenantId` comes from the authenticated context, never from the body.
 * 3. The write is tenant-scoped and never organization-scoped.
 * 4. Toggling the flag cannot affect an act decision — `actable`/`claimable`
 *    are identical with the flag on and off, for every principal.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { GET as getTaskSettings, PUT as putTaskSettings } from '../task-settings/route'
import {
  TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY,
  WORKFLOWS_CONFIG_MODULE,
  readTaskPermissionsBusinessContext,
  resolveTaskVisibilityPolicy,
} from '../../lib/task-permission-settings'
import {
  decideTaskVisibility,
  type BackofficeTaskPrincipal,
  type TaskEntityAccessMap,
  type TaskFacts,
} from '../../lib/task-visibility'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

const { createRequestContainer } = jest.requireMock(
  '@open-mercato/shared/lib/di/container',
) as { createRequestContainer: jest.Mock }
const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server') as {
  getAuthFromRequest: jest.Mock
}

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const OTHER_TENANT_ID = '11111111-2222-4333-8444-eeeeeeeeeeee'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const USER_ID = '11111111-2222-4333-8444-cccccccccccc'

let moduleConfigService: { getValue: jest.Mock; setValue: jest.Mock }

function useContainer(): void {
  createRequestContainer.mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'moduleConfigService') return moduleConfigService
      throw new Error(`[internal] unexpected DI token ${token}`)
    },
  })
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/workflows/task-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  moduleConfigService = {
    getValue: jest.fn(async () => true),
    setValue: jest.fn(async () => null),
  }
  useContainer()
  getAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
})

describe('GET /api/workflows/task-settings', () => {
  test('reads the tenant-scoped value', async () => {
    moduleConfigService.getValue.mockResolvedValue(false)
    const response = await getTaskSettings(
      new Request('http://localhost/api/workflows/task-settings'),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ taskPermissionsBusinessContext: false })
    expect(moduleConfigService.getValue).toHaveBeenCalledWith(
      WORKFLOWS_CONFIG_MODULE,
      TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY,
      expect.objectContaining({ scope: { tenantId: TENANT_ID } }),
    )
  })

  test('never organization-scopes the read', async () => {
    await getTaskSettings(new Request('http://localhost/api/workflows/task-settings'))
    const [, , options] = moduleConfigService.getValue.mock.calls[0] as [
      string,
      string,
      { scope?: Record<string, unknown> },
    ]
    expect(Object.keys(options.scope ?? {})).toEqual(['tenantId'])
  })

  test('401s without a tenant context', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: null })
    const response = await getTaskSettings(
      new Request('http://localhost/api/workflows/task-settings'),
    )
    expect(response.status).toBe(401)
    expect(moduleConfigService.getValue).not.toHaveBeenCalled()
  })

  test('a failing read reports true, not the permissive legacy filter', async () => {
    moduleConfigService.getValue.mockRejectedValue(new Error('[internal] config unavailable'))
    const response = await getTaskSettings(
      new Request('http://localhost/api/workflows/task-settings'),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ taskPermissionsBusinessContext: true })
  })

  test('an unresolvable container reports true', async () => {
    createRequestContainer.mockRejectedValue(new Error('[internal] no container'))
    const response = await getTaskSettings(
      new Request('http://localhost/api/workflows/task-settings'),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ taskPermissionsBusinessContext: true })
  })
})

describe('PUT /api/workflows/task-settings', () => {
  test('writes the tenant-scoped value', async () => {
    const response = await putTaskSettings(jsonRequest({ taskPermissionsBusinessContext: false }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      taskPermissionsBusinessContext: false,
    })
    expect(moduleConfigService.setValue).toHaveBeenCalledWith(
      WORKFLOWS_CONFIG_MODULE,
      TASK_PERMISSIONS_BUSINESS_CONTEXT_KEY,
      false,
      { tenantId: TENANT_ID },
    )
  })

  test('takes the tenant id from auth even when the body supplies one', async () => {
    await putTaskSettings(
      jsonRequest({ taskPermissionsBusinessContext: false, tenantId: OTHER_TENANT_ID }),
    )
    const [, , , scope] = moduleConfigService.setValue.mock.calls[0] as [
      string,
      string,
      unknown,
      { tenantId: string },
    ]
    expect(scope).toEqual({ tenantId: TENANT_ID })
  })

  test('rejects a non-boolean value', async () => {
    const response = await putTaskSettings(jsonRequest({ taskPermissionsBusinessContext: 'false' }))
    expect(response.status).toBe(400)
    expect(moduleConfigService.setValue).not.toHaveBeenCalled()
  })

  test('rejects invalid JSON', async () => {
    const response = await putTaskSettings(
      new Request('http://localhost/api/workflows/task-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    )
    expect(response.status).toBe(400)
    expect(moduleConfigService.setValue).not.toHaveBeenCalled()
  })

  test('401s without a tenant context', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    const response = await putTaskSettings(jsonRequest({ taskPermissionsBusinessContext: false }))
    expect(response.status).toBe(401)
    expect(moduleConfigService.setValue).not.toHaveBeenCalled()
  })

  test('refuses rather than silently dropping the write when storage is unavailable', async () => {
    createRequestContainer.mockRejectedValue(new Error('[internal] no container'))
    const response = await putTaskSettings(jsonRequest({ taskPermissionsBusinessContext: false }))
    expect(response.status).toBe(503)
  })
})

describe('readTaskPermissionsBusinessContext', () => {
  test('only an explicitly false value opts a tenant out', async () => {
    const cases: [unknown, boolean][] = [
      [true, true],
      [false, false],
      ['false', false],
      ['true', true],
      [null, true],
      [undefined, true],
      ['nonsense', true],
      [{}, true],
    ]
    for (const [stored, expected] of cases) {
      const service = { getValue: jest.fn(async () => stored), setValue: jest.fn() }
      await expect(readTaskPermissionsBusinessContext(service, TENANT_ID)).resolves.toBe(expected)
    }
  })

  test('a missing service is not an opt-out', async () => {
    await expect(readTaskPermissionsBusinessContext(null, TENANT_ID)).resolves.toBe(true)
  })
})

/**
 * Design §6.2, the one-line summary for the reviewer: *the opt-out is a SELECT
 * filter, not an authorization mode.* Asserted here rather than only in the
 * predicate's own suite because this is the file that produces the flag.
 */
describe('the opt-out cannot affect an act decision', () => {
  const emptyAccess: TaskEntityAccessMap = new Map()

  function principal(overrides: Partial<BackofficeTaskPrincipal> = {}): BackofficeTaskPrincipal {
    return {
      kind: 'backoffice',
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationIds: [ORG_ID],
      roleNames: [],
      grantedFeatures: ['workflows.tasks.view'],
      isSuperAdmin: false,
      ...overrides,
    }
  }

  function task(overrides: Partial<TaskFacts> = {}): TaskFacts {
    return {
      id: 'task-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      status: 'PENDING',
      assignedTo: null,
      assigneeKind: 'user',
      assignedToRoles: null,
      claimedBy: null,
      entityBindings: [],
      ...overrides,
    }
  }

  const scenarios: [string, BackofficeTaskPrincipal, TaskFacts][] = [
    ['an unrelated reader', principal(), task({ assignedTo: 'someone-else' })],
    ['the assignee', principal(), task({ assignedTo: USER_ID })],
    [
      'a role-queue member',
      principal({ roleNames: ['approver'] }),
      task({ assignedToRoles: ['approver'] }),
    ],
    [
      'a claimant',
      principal(),
      task({ assignedTo: 'someone-else', claimedBy: USER_ID, status: 'IN_PROGRESS' }),
    ],
    [
      'an administrator',
      principal({ grantedFeatures: ['workflows.tasks.view', 'workflows.tasks.view_all'] }),
      task({ assignedTo: 'someone-else' }),
    ],
  ]

  test.each(scenarios)('%s gets identical actable/claimable either way', (_label, who, what) => {
    const enabled = decideTaskVisibility(who, what, emptyAccess, { businessContextEnabled: true })
    const disabled = decideTaskVisibility(who, what, emptyAccess, { businessContextEnabled: false })
    expect({ actable: disabled.actable, claimable: disabled.claimable }).toEqual({
      actable: enabled.actable,
      claimable: enabled.claimable,
    })
  })

  test('the opt-out is additive on reads — it never hides a row the new model shows', () => {
    for (const [, who, what] of scenarios) {
      const enabled = decideTaskVisibility(who, what, emptyAccess, { businessContextEnabled: true })
      const disabled = decideTaskVisibility(who, what, emptyAccess, {
        businessContextEnabled: false,
      })
      if (enabled.visible) expect(disabled.visible).toBe(true)
    }
  })

  test('a cross-tenant row stays denied with the flag off', () => {
    const decision = decideTaskVisibility(
      principal(),
      task({ tenantId: OTHER_TENANT_ID, assignedTo: USER_ID }),
      emptyAccess,
      { businessContextEnabled: false },
    )
    expect(decision).toEqual({
      visible: false,
      actable: false,
      claimable: false,
      reason: 'denied:tenant',
    })
  })

  test('resolveTaskVisibilityPolicy hands the predicate the stored answer', async () => {
    const service = { getValue: jest.fn(async () => false), setValue: jest.fn() }
    await expect(resolveTaskVisibilityPolicy(service, TENANT_ID)).resolves.toEqual({
      businessContextEnabled: false,
    })
  })
})
