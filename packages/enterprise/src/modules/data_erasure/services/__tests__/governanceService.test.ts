import type { EntityManager } from '@mikro-orm/postgresql'
import {
  clearPrivacyDataClasses,
  registerPrivacyDataClass,
  type PrivacyDataClassHandler,
} from '@open-mercato/shared/lib/privacy'
import { PrivacyGovernanceService } from '../governanceService'
import type { PrivacyPolicyService } from '../policyService'
import type { PrivacyLegalHoldService } from '../legalHoldService'
import type { PrivacyOperation } from '../../data/entities'

const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }

describe('PrivacyGovernanceService', () => {
  beforeEach(() => {
    clearPrivacyDataClasses()
    registerPrivacyDataClass({
      id: 'test.people',
      module: 'test',
      title: 'Test people',
      handlerService: 'testPeoplePrivacyHandler',
      subjectKinds: ['test:person'],
      subjectActions: ['discover', 'export', 'erase', 'anonymize'],
    })
  })

  afterEach(() => {
    clearPrivacyDataClasses()
  })

  it('blocks erasure before calling the owning handler when a legal hold is active', async () => {
    const eraseSubject = jest.fn(async () => ({ affected: 1 }))
    const { service } = createService({
      handler: { eraseSubject },
      holds: [{ id: 'hold-1', subjectKind: 'test:person' }],
    })

    const result = await service.runSubjectRequest(scope, 'actor-1', {
      action: 'erase',
      subject: { kind: 'test:person', id: 'person-1' },
      dryRun: false,
    })

    expect(eraseSubject).not.toHaveBeenCalled()
    expect(result.operation.status).toBe('blocked')
  })

  it('returns export data without storing it in the operation report', async () => {
    const { service } = createService({
      handler: {
        exportSubject: async () => ({
          recordCount: 1,
          data: { email: 'private@example.com' },
        }),
      },
    })

    const result = await service.runSubjectRequest(scope, 'actor-1', {
      action: 'export',
      subject: { kind: 'test:person', id: 'person-1' },
      dryRun: true,
    })

    expect(result.exports?.['test.people']?.data).toEqual({ email: 'private@example.com' })
    expect(JSON.stringify(result.operation.reportJson)).not.toContain('private@example.com')
  })

  it('writes a restore manifest after a completed erasure', async () => {
    const append = jest.fn(async () => undefined)
    const { service } = createService({
      handler: { eraseSubject: async () => ({ affected: 1 }) },
      appendManifest: append,
    })

    const result = await service.runSubjectRequest(scope, 'actor-1', {
      action: 'erase',
      subject: { kind: 'test:person', id: 'person-1' },
      dryRun: false,
    })

    expect(result.operation.status).toBe('completed')
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      requestId: result.operation.id,
      subjectKind: 'test:person',
      subjectId: 'person-1',
    }))
  })

  it('marks erasure partial when the restore manifest cannot be written', async () => {
    const { service } = createService({
      handler: { eraseSubject: async () => ({ affected: 1 }) },
      appendManifest: async () => {
        throw new Error('[internal] manifest unavailable')
      },
    })

    const result = await service.runSubjectRequest(scope, 'actor-1', {
      action: 'erase',
      subject: { kind: 'test:person', id: 'person-1' },
      dryRun: false,
    })

    expect(result.operation.status).toBe('partial')
    expect(result.operation.reportJson).toEqual(expect.objectContaining({ manifestStatus: 'failed' }))
  })

  it('reports dry-run findings without failing the preview', async () => {
    registerPrivacyDataClass({
      id: 'test.sandbox',
      module: 'test',
      title: 'Sandbox data',
      handlerService: 'testPeoplePrivacyHandler',
      subjectKinds: [],
      subjectActions: [],
      environmentSanitization: { categories: ['personal_data'] },
    })
    const previous = process.env.OM_ENVIRONMENT_CLASSIFICATION
    process.env.OM_ENVIRONMENT_CLASSIFICATION = 'sandbox'
    try {
      const { service } = createService({
        handler: {
          sanitizeEnvironment: async () => ({ matched: 4, affected: 0 }),
          verifyEnvironmentSanitization: async () => ({
            passed: false,
            findings: [{ code: 'test.content_present', count: 4 }],
          }),
        },
      })
      const operation = await service.runEnvironmentSanitization(scope, 'actor-1', {
        profile: 'sandbox-strict',
        dryRun: true,
        confirmation: null,
      })
      expect(operation.status).toBe('completed')
      expect(operation.reportJson).toEqual(expect.objectContaining({
        environmentClassification: 'sandbox',
        totals: expect.objectContaining({ findings: 4 }),
      }))
    } finally {
      if (previous === undefined) delete process.env.OM_ENVIRONMENT_CLASSIFICATION
      else process.env.OM_ENVIRONMENT_CLASSIFICATION = previous
    }
  })

  it('fails an applied class when verification still finds unsafe data', async () => {
    registerPrivacyDataClass({
      id: 'test.sandbox',
      module: 'test',
      title: 'Sandbox data',
      handlerService: 'testPeoplePrivacyHandler',
      subjectKinds: [],
      subjectActions: [],
      environmentSanitization: { categories: ['credentials'] },
    })
    const previous = process.env.OM_ENVIRONMENT_CLASSIFICATION
    process.env.OM_ENVIRONMENT_CLASSIFICATION = 'test'
    try {
      const { service } = createService({
        handler: {
          sanitizeEnvironment: async () => ({ matched: 1, affected: 1 }),
          verifyEnvironmentSanitization: async () => ({
            passed: false,
            findings: [{ code: 'test.credential_present', count: 1 }],
          }),
        },
      })
      const operation = await service.runEnvironmentSanitization(scope, 'actor-1', {
        profile: 'sandbox-strict',
        dryRun: false,
        confirmation: 'SANITIZE_NON_PRODUCTION',
      })
      expect(operation.status).toBe('failed')
      expect(operation.reportJson).toEqual(expect.objectContaining({
        totals: expect.objectContaining({ failed: 1 }),
      }))
    } finally {
      if (previous === undefined) delete process.env.OM_ENVIRONMENT_CLASSIFICATION
      else process.env.OM_ENVIRONMENT_CLASSIFICATION = previous
    }
  })
})

function createService(input: {
  handler: PrivacyDataClassHandler
  holds?: Array<Record<string, unknown>>
  appendManifest?: (entry: {
    requestId: string
    tenantId: string
    organizationId: string
    subjectKind: string
    subjectId: string
    executedAt: Date
  }) => Promise<void>
}) {
  let sequence = 0
  const flush = jest.fn(async () => undefined)
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({
      id: `operation-${++sequence}`,
      createdAt: new Date('2026-08-21T10:00:00.000Z'),
      updatedAt: new Date('2026-08-21T10:00:00.000Z'),
      completedAt: null,
      reportJson: null,
      ...data,
    }),
    persist: () => ({ flush }),
    flush,
  } as unknown as EntityManager
  const legalHoldService = {
    findActive: jest.fn(async () => input.holds ?? []),
  } as unknown as PrivacyLegalHoldService
  const policyService = {} as PrivacyPolicyService
  const service = new PrivacyGovernanceService({
    em,
    privacyPolicyService: policyService,
    privacyLegalHoldService: legalHoldService,
    resolveHandler: () => input.handler,
    resolveManifest: () => input.appendManifest ? { append: input.appendManifest } : null,
  })
  return { service, flush }
}
