import type { AwilixContainer } from 'awilix'

const provisionMock = jest.fn()
jest.mock('../lib/identity/agentPrincipalService', () => ({
  provisionAgentPrincipal: (...args: unknown[]) => provisionMock(...args),
}))

const aclRow: { featuresJson: string[] } = { featuresJson: [] }
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => aclRow),
}))

const authEntities = { RoleAcl: class RoleAcl {} }
jest.mock('@open-mercato/core/modules/auth/data/entities', () => authEntities, { virtual: false })

import { provisionTaskExecutionPrincipal, taskExecutionAgentId } from '../lib/tasks/executionPrincipal'

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const TASK_ID = '44444444-4444-4444-8444-444444444444'

const flushMock = jest.fn(async () => {})
const container = {
  resolve: (name: string) => {
    if (name === 'em') return { fork: () => ({ persist: jest.fn(), flush: flushMock }) }
    throw new Error(`unexpected resolve(${name})`)
  },
} as unknown as AwilixContainer

describe('taskExecutionAgentId', () => {
  it('namespaces the synthetic id so it can never collide with a registry agent', () => {
    expect(taskExecutionAgentId(TASK_ID)).toBe(`task:${TASK_ID}`)
  })
})

describe('provisionTaskExecutionPrincipal', () => {
  beforeEach(() => {
    provisionMock.mockReset()
    flushMock.mockClear()
    aclRow.featuresJson = []
    provisionMock.mockResolvedValue({
      principal: { id: 'principal-1' },
      userId: 'agent-user-1',
      roleId: 'role-1',
      interactiveLoginDisabled: true,
    })
  })

  it('provisions with the synthetic agent id and the requested features', async () => {
    await provisionTaskExecutionPrincipal(container, SCOPE, {
      taskDefinitionId: TASK_ID,
      displayName: 'Task: Health check',
      grantedFeatures: ['customers.deals.view'],
    })

    expect(provisionMock).toHaveBeenCalledWith(container, SCOPE, {
      agentDefinitionId: `task:${TASK_ID}`,
      displayName: 'Task: Health check',
      credentialMode: 'internal',
      roleFeatures: ['customers.deals.view'],
    })
  })

  it('replaces (not merges) the role ACL so features can be narrowed', async () => {
    aclRow.featuresJson = ['customers.deals.view', 'workflows.*']

    await provisionTaskExecutionPrincipal(container, SCOPE, {
      taskDefinitionId: TASK_ID,
      displayName: 'Task: Health check',
      grantedFeatures: ['customers.deals.view'],
    })

    expect(aclRow.featuresJson).toEqual(['customers.deals.view'])
    expect(flushMock).toHaveBeenCalled()
  })

  it('does not rewrite the ACL when the feature set already matches', async () => {
    aclRow.featuresJson = ['a.view', 'b.view']

    await provisionTaskExecutionPrincipal(container, SCOPE, {
      taskDefinitionId: TASK_ID,
      displayName: 'Task: Health check',
      grantedFeatures: ['b.view', 'a.view'],
    })

    expect(flushMock).not.toHaveBeenCalled()
  })
})
