import {
  AgentModelUsageService,
  resolveProviderComplianceMetadata,
} from '../modelUsageService'
import { AgentModelUsage } from '../../../data/entities'

describe('AgentModelUsageService', () => {
  afterEach(() => {
    delete process.env.OM_AI_PROVIDER_COMPLIANCE_JSON
  })

  it('resolves provider location and retention without exposing configuration errors', () => {
    process.env.OM_AI_PROVIDER_COMPLIANCE_JSON = JSON.stringify({
      openai: { location: 'EU', retention: '30 days, no training' },
    })
    expect(resolveProviderComplianceMetadata('openai')).toEqual({
      dataLocation: 'EU',
      retentionPolicy: '30 days, no training',
    })
    expect(resolveProviderComplianceMetadata('anthropic')).toEqual({
      dataLocation: null,
      retentionPolicy: null,
    })
  })

  it('records one scoped row per run/provider/model and snapshots metadata', async () => {
    process.env.OM_AI_PROVIDER_COMPLIANCE_JSON = JSON.stringify({
      openai: { location: 'EU', retention: 'zero data retention' },
    })
    const persisted: unknown[] = []
    const fork = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_entity, value) => value),
      persist: jest.fn((value) => persisted.push(value)),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const em = { fork: () => fork }
    const service = new AgentModelUsageService(em as never)

    await service.record({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentRunId: 'run-1',
      agentId: 'deals.health',
      runtime: 'native',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
    })

    expect(fork.findOne).toHaveBeenCalledWith(AgentModelUsage, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      agentRunId: 'run-1',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
    })
    expect(persisted).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        dataLocation: 'EU',
        retentionPolicy: 'zero data retention',
      }),
    ])
  })

  it('returns a tenant-scoped aggregate with explicit missing metadata', async () => {
    const execute = jest.fn().mockResolvedValue([
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        dataLocation: null,
        retentionPolicy: null,
        runCount: '2',
        firstUsedAt: '2026-08-20T10:00:00.000Z',
        lastUsedAt: '2026-08-21T10:00:00.000Z',
      },
    ])
    const service = new AgentModelUsageService({
      getConnection: () => ({ execute }),
    } as never)

    await expect(service.registry({ tenantId: 'tenant-1', organizationId: 'org-1' })).resolves.toEqual([
      {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        dataLocation: 'not_configured',
        retentionPolicy: 'not_configured',
        runCount: 2,
        firstUsedAt: '2026-08-20T10:00:00.000Z',
        lastUsedAt: '2026-08-21T10:00:00.000Z',
      },
    ])
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('where tenant_id = ? and organization_id = ?'), [
      'tenant-1',
      'org-1',
    ])
  })
})
