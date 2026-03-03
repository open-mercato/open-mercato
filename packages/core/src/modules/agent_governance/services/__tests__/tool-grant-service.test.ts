import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createToolGrantService } from '../tool-grant-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const mockedFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockedFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const fakeEm = {} as EntityManager

describe('tool-grant-service', () => {
  beforeEach(() => {
    mockedFindOneWithDecryption.mockReset()
    mockedFindWithDecryption.mockReset()
  })

  test('allows write tools when no active policy exists', async () => {
    mockedFindOneWithDecryption.mockResolvedValueOnce(null as never)

    const service = createToolGrantService({ em: fakeEm })
    const decision = await service.assertToolGrant({
      toolName: 'agent_run',
      tenantId: '10ac0d8b-64ff-42ce-9d95-52a9f32da780',
      organizationId: '021f5e86-c7f8-4fac-9a22-9b1f90d3ec4e',
      actionClass: 'write',
    })

    expect(decision.allowed).toBe(true)
    expect(decision.policyMode).toBe('auto')
  })

  test('blocks write tools when active policy mode is propose', async () => {
    mockedFindOneWithDecryption.mockResolvedValueOnce({
      id: 'policy-1',
      defaultMode: 'propose',
    } as never)

    const service = createToolGrantService({ em: fakeEm })

    await expect(
      service.assertToolGrant({
        toolName: 'skill_capture',
        tenantId: '10ac0d8b-64ff-42ce-9d95-52a9f32da780',
        organizationId: '021f5e86-c7f8-4fac-9a22-9b1f90d3ec4e',
        actionClass: 'write',
      }),
    ).rejects.toMatchObject({ code: 'TOOL_GRANT_POLICY_MODE_BLOCKED' })
  })

  test('blocks fail-closed risk band when approval is required', async () => {
    mockedFindOneWithDecryption.mockResolvedValueOnce({
      id: 'policy-1',
      defaultMode: 'auto',
    } as never)
    mockedFindWithDecryption.mockResolvedValueOnce([
      {
        id: 'risk-band-1',
        name: 'critical-write',
        failClosed: true,
        requiresApproval: true,
      },
    ] as never)

    const service = createToolGrantService({ em: fakeEm })

    await expect(
      service.assertToolGrant({
        toolName: 'agent_run',
        tenantId: '10ac0d8b-64ff-42ce-9d95-52a9f32da780',
        organizationId: '021f5e86-c7f8-4fac-9a22-9b1f90d3ec4e',
        actionClass: 'write',
        riskScore: 95,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_GRANT_RISK_BAND_BLOCKED' })
  })
})
