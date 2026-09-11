/**
 * @jest-environment node
 *
 * Workflow execution identity (`grantedFeatures`). Two invariants are load-
 * bearing and pinned here:
 *   - a definition declaring NO grant behaves exactly as it always did;
 *   - a definition declaring a grant acts as its own principal ALWAYS, and
 *     fails closed rather than reverting to the starting user.
 */

const provisionMock = jest.fn(async () => ({ userId: 'principal-user', roleId: 'principal-role' }))
const resolveMock = jest.fn(async () => null as string | null)

jest.mock('../../../auth/lib/executionPrincipal', () => ({
  normalizeFeatureList: (value: unknown) =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        ).sort((a, b) => a.localeCompare(b))
      : [],
  provisionExecutionPrincipal: (...args: unknown[]) => provisionMock(...(args as [])),
  resolveExecutionPrincipalUserId: (...args: unknown[]) => resolveMock(...(args as [])),
}))

import type { AwilixContainer } from 'awilix'
import {
  authorizeWorkflowGrantChange,
  definitionDeclaresGrant,
  findUngrantableFeatures,
  resolveWorkflowDefinitionExecutionUserId,
  syncWorkflowDefinitionPrincipal,
  WorkflowExecutionPrincipalMissingError,
  workflowPrincipalKey,
} from '../definition-grant'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const DEFINITION = {
  id: 'def-1',
  workflowId: 'claims_resolution',
  tenantId: TENANT,
  organizationId: ORG,
  grantedFeatures: null as string[] | null,
}

const container = { resolve: () => ({ fork: () => ({}) }) } as unknown as AwilixContainer

beforeEach(() => {
  provisionMock.mockClear()
  resolveMock.mockClear()
  resolveMock.mockResolvedValue(null)
  DEFINITION.grantedFeatures = null
})

describe('findUngrantableFeatures', () => {
  it('is wildcard-aware — a plain includes() would refuse a grant the author holds', () => {
    expect(findUngrantableFeatures(['workflows.definitions.view'], ['workflows.*'])).toEqual([])
    expect(findUngrantableFeatures(['workflows.definitions.view'], ['*'])).toEqual([])
    expect(findUngrantableFeatures(['sales.orders.edit'], ['workflows.*'])).toEqual(['sales.orders.edit'])
  })
})

describe('workflowPrincipalKey', () => {
  it('namespaces by definition id, so the grant (and its principal) is per VERSION', () => {
    expect(workflowPrincipalKey('def-1')).toBe('workflow:def-1')
  })
})

describe('authorizeWorkflowGrantChange', () => {
  function rbac(granted: string[], superAdmin = false) {
    return {
      userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) =>
        superAdmin ||
        required.every((feature) =>
          granted.some(
            (grant) =>
              grant === '*' ||
              (grant.endsWith('.*') &&
                (feature === grant.slice(0, -2) || feature.startsWith(`${grant.slice(0, -2)}.`))) ||
              grant === feature,
          ),
        ),
      ),
      getGrantedFeatures: jest.fn(async () => granted),
    }
  }

  const params = { userId: 'user-1', scope: { tenantId: TENANT, organizationId: ORG } }

  it('does not gate a no-op change, so ordinary saves of a granted definition still work', async () => {
    const service = rbac([])
    const failure = await authorizeWorkflowGrantChange(service, {
      ...params,
      requested: ['b.view', 'a.view'],
      current: ['a.view', 'b.view'],
    })
    expect(failure).toBeNull()
    expect(service.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('refuses when the user lacks workflows.definitions.grant_features', async () => {
    const failure = await authorizeWorkflowGrantChange(rbac(['workflows.definitions.edit']), {
      ...params,
      requested: ['workflows.definitions.edit'],
      current: [],
    })
    expect(failure?.status).toBe(403)
    expect(failure?.body.code).toBe('WORKFLOW_GRANT_FEATURE_REQUIRED')
  })

  it('refuses a grant that exceeds the saving user\'s own features and names the gap', async () => {
    const failure = await authorizeWorkflowGrantChange(
      rbac(['workflows.definitions.grant_features', 'customers.deals.view']),
      { ...params, requested: ['customers.deals.view', 'sales.orders.delete'], current: [] },
    )
    expect(failure?.status).toBe(403)
    expect(failure?.body.code).toBe('WORKFLOW_GRANT_EXCEEDS_GRANTOR_FEATURES')
    expect(failure?.body.details?.missingFeatures).toEqual(['sales.orders.delete'])
  })

  it('allows a grant covered by a wildcard the user holds', async () => {
    const failure = await authorizeWorkflowGrantChange(
      rbac(['workflows.definitions.grant_features', 'customers.*']),
      { ...params, requested: ['customers.deals.view'], current: [] },
    )
    expect(failure).toBeNull()
  })

  it('allows CLEARING a grant with only the grant feature — narrowing needs no coverage', async () => {
    const failure = await authorizeWorkflowGrantChange(rbac(['workflows.definitions.grant_features']), {
      ...params,
      requested: [],
      current: ['sales.orders.delete'],
    })
    expect(failure).toBeNull()
  })
})

describe('resolveWorkflowDefinitionExecutionUserId', () => {
  it('REGRESSION: a definition declaring no grant borrows the starting user, unchanged', async () => {
    expect(definitionDeclaresGrant(DEFINITION)).toBe(false)
    const actor = await resolveWorkflowDefinitionExecutionUserId({} as never, DEFINITION, 'starter-user')
    expect(actor).toBe('starter-user')
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('a granted definition acts as its own principal even when an admin started it', async () => {
    DEFINITION.grantedFeatures = ['customers.deals.view']
    resolveMock.mockResolvedValue('principal-user')

    const actor = await resolveWorkflowDefinitionExecutionUserId({} as never, DEFINITION, 'admin-user')

    expect(actor).toBe('principal-user')
    expect(resolveMock).toHaveBeenCalledWith({}, 'workflow:def-1', {
      tenantId: TENANT,
      organizationId: ORG,
    })
  })

  it('fails CLOSED when a declared grant has no provisioned principal', async () => {
    DEFINITION.grantedFeatures = ['customers.deals.view']
    resolveMock.mockResolvedValue(null)

    await expect(
      resolveWorkflowDefinitionExecutionUserId({} as never, DEFINITION, 'admin-user'),
    ).rejects.toBeInstanceOf(WorkflowExecutionPrincipalMissingError)
  })
})

describe('syncWorkflowDefinitionPrincipal', () => {
  it('provisions nothing for a definition that never declared a grant', async () => {
    await syncWorkflowDefinitionPrincipal(container, DEFINITION)
    expect(provisionMock).not.toHaveBeenCalled()
  })

  it('pins the principal to exactly the declared grant', async () => {
    DEFINITION.grantedFeatures = ['b.view', 'a.view']
    await syncWorkflowDefinitionPrincipal(container, DEFINITION)

    expect(provisionMock).toHaveBeenCalledWith(
      container,
      { tenantId: TENANT, organizationId: ORG },
      expect.objectContaining({
        principalKey: 'workflow:def-1',
        features: ['a.view', 'b.view'],
      }),
    )
  })

  it('re-scopes to nothing when a grant is cleared, instead of leaving a stray ACL', async () => {
    await syncWorkflowDefinitionPrincipal(container, DEFINITION, {
      previousFeatures: ['sales.orders.delete'],
    })

    expect(provisionMock).toHaveBeenCalledWith(
      container,
      expect.anything(),
      expect.objectContaining({ features: [] }),
    )
  })
})
