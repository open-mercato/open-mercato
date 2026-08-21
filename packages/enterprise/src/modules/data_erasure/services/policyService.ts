import type { EntityManager } from '@mikro-orm/postgresql'
import type { RequiredEntityData } from '@mikro-orm/core'
import { getPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import type { PrivacyScope } from '@open-mercato/shared/lib/privacy'
import { PrivacyRetentionPolicy } from '../data/entities'
import type { RetentionPolicyCreateInput, RetentionPolicyUpdateInput } from '../data/validators'
import { PrivacyServiceError } from './errors'

export class PrivacyPolicyService {
  constructor(private readonly em: EntityManager) {}

  list(scope: PrivacyScope): Promise<PrivacyRetentionPolicy[]> {
    return this.em.find(PrivacyRetentionPolicy, scope, { orderBy: { dataClassId: 'asc' } })
  }

  async get(scope: PrivacyScope, id: string): Promise<PrivacyRetentionPolicy> {
    const policy = await this.em.findOne(PrivacyRetentionPolicy, { id, ...scope })
    if (!policy) throw new PrivacyServiceError('Retention policy not found.', 'POLICY_NOT_FOUND', 404)
    return policy
  }

  async create(scope: PrivacyScope, actorId: string, input: RetentionPolicyCreateInput): Promise<PrivacyRetentionPolicy> {
    this.assertSupported(input.dataClassId, input.action)
    const existing = await this.em.findOne(PrivacyRetentionPolicy, { ...scope, dataClassId: input.dataClassId })
    if (existing) throw new PrivacyServiceError('A policy already exists for this data class.', 'POLICY_EXISTS', 409)
    const policy = this.em.create(PrivacyRetentionPolicy, {
      ...scope,
      ...input,
      createdBy: actorId,
    } as RequiredEntityData<PrivacyRetentionPolicy>)
    await this.em.persist(policy).flush()
    return policy
  }

  async update(
    scope: PrivacyScope,
    id: string,
    input: RetentionPolicyUpdateInput,
  ): Promise<PrivacyRetentionPolicy> {
    const policy = await this.get(scope, id)
    this.assertSupported(policy.dataClassId, input.action ?? policy.action)
    if (input.retentionDays !== undefined) policy.retentionDays = input.retentionDays
    if (input.action !== undefined) policy.action = input.action
    if (input.batchSize !== undefined) policy.batchSize = input.batchSize
    if (input.isActive !== undefined) policy.isActive = input.isActive
    await this.em.flush()
    return policy
  }

  private assertSupported(dataClassId: string, action: string): void {
    const definition = getPrivacyDataClass(dataClassId)
    if (!definition?.retention) {
      throw new PrivacyServiceError('Data class does not support retention.', 'RETENTION_NOT_SUPPORTED', 400)
    }
    if (!definition.retention.actions.includes(action as 'delete' | 'anonymize')) {
      throw new PrivacyServiceError('Retention action is not supported.', 'RETENTION_ACTION_NOT_SUPPORTED', 400)
    }
  }
}
