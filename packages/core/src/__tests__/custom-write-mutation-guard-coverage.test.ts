import type { AwilixContainer } from 'awilix'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { runMessageMutationGuards } from '../modules/messages/api/guards'
import { runIntegrationMutationGuards } from '../modules/integrations/api/guards'
import { runPaymentGatewayMutationGuards } from '../modules/payment_gateways/api/guards'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const requiredFeature = 'record_locks.enforce'

type GuardRunner = (
  container: AwilixContainer,
  input: MutationGuardInput,
  extraFeatures?: string[],
) => Promise<{ ok: boolean }>

function createContainer(getGrantedFeatures: jest.Mock): AwilixContainer {
  return {
    hasRegistration: (name: string) => name === 'rbacService',
    resolve: (name: string) => {
      if (name === 'rbacService') return { getGrantedFeatures }
      throw new Error(`[test] no registration for ${name}`)
    },
  } as unknown as AwilixContainer
}

function createInput(): MutationGuardInput {
  return {
    tenantId,
    organizationId,
    userId,
    resourceKind: 'test.record',
    resourceId: 'record-1',
    operation: 'update',
    requestMethod: 'POST',
    requestHeaders: new Headers(),
    mutationPayload: { title: 'Changed' },
  }
}

function createBlockingGuard(): MutationGuard {
  return {
    id: 'test.feature-gated-lock',
    targetEntity: 'test.record',
    operations: ['update'],
    features: [requiredFeature],
    validate: jest.fn().mockResolvedValue({ ok: false, status: 423, message: 'Locked' }),
  }
}

const helperCases: Array<[string, GuardRunner]> = [
  ['messages', runMessageMutationGuards],
  ['integrations', runIntegrationMutationGuards],
  ['payment gateways', runPaymentGatewayMutationGuards],
]

describe.each(helperCases)('%s custom write guards', (_name, runGuards) => {
  afterEach(() => {
    registerMutationGuards([])
  })

  it('runs registry guards using RBAC-resolved feature grants', async () => {
    const getGrantedFeatures = jest.fn().mockResolvedValue([requiredFeature])
    registerMutationGuards([{ moduleId: 'test', guards: [createBlockingGuard()] }])

    const result = await runGuards(createContainer(getGrantedFeatures), createInput(), [])

    expect(result.ok).toBe(false)
    expect(getGrantedFeatures).toHaveBeenCalledWith(userId, { tenantId, organizationId })
  })
})
