import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core'
import type { PrivacyScope, PrivacySubjectReference } from '@open-mercato/shared/lib/privacy'
import { getPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { PrivacyLegalHold } from '../data/entities'
import type { LegalHoldCreateInput } from '../data/validators'
import { PrivacyServiceError } from './errors'

export class PrivacyLegalHoldService {
  constructor(private readonly em: EntityManager) {}

  list(scope: PrivacyScope): Promise<PrivacyLegalHold[]> {
    return this.em.find(PrivacyLegalHold, scope, { orderBy: { createdAt: 'desc' } })
  }

  async get(scope: PrivacyScope, id: string): Promise<PrivacyLegalHold> {
    const hold = await this.em.findOne(PrivacyLegalHold, { id, ...scope })
    if (!hold) throw new PrivacyServiceError('Legal hold not found.', 'LEGAL_HOLD_NOT_FOUND', 404)
    return hold
  }

  async create(scope: PrivacyScope, actorId: string, input: LegalHoldCreateInput): Promise<PrivacyLegalHold> {
    const definition = input.dataClassId ? getPrivacyDataClass(input.dataClassId) : null
    if (input.dataClassId && !definition) {
      throw new PrivacyServiceError('Data class not found.', 'DATA_CLASS_NOT_FOUND', 400)
    }
    if (definition && input.subject && !definition.subjectKinds.includes(input.subject.kind)) {
      throw new PrivacyServiceError(
        'Data class does not support legal holds for this subject kind.',
        'LEGAL_HOLD_SUBJECT_NOT_SUPPORTED',
        400,
      )
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new PrivacyServiceError('Legal hold expiry must be in the future.', 'LEGAL_HOLD_EXPIRY_INVALID', 400)
    }
    const hold = this.em.create(PrivacyLegalHold, {
      ...scope,
      dataClassId: input.dataClassId ?? null,
      subjectKind: input.subject?.kind ?? null,
      subjectId: input.subject?.id ?? null,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      createdBy: actorId,
    } as RequiredEntityData<PrivacyLegalHold>)
    await this.em.persist(hold).flush()
    return hold
  }

  async release(scope: PrivacyScope, id: string, actorId: string): Promise<PrivacyLegalHold> {
    const hold = await this.get(scope, id)
    if (!hold.releasedAt) {
      hold.releasedAt = new Date()
      hold.releasedBy = actorId
      await this.em.flush()
    }
    return hold
  }

  async findActive(
    scope: PrivacyScope,
    input: { dataClassId?: string; subject?: PrivacySubjectReference },
  ): Promise<PrivacyLegalHold[]> {
    const now = new Date()
    const filters: FilterQuery<PrivacyLegalHold> = {
      ...scope,
      releasedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }
    const candidates = await this.em.find(PrivacyLegalHold, filters)
    return candidates.filter((hold) => {
      const classMatches = !hold.dataClassId || hold.dataClassId === input.dataClassId
      const subjectMatches = !hold.subjectKind || !input.subject || (
        hold.subjectKind === input.subject.kind && hold.subjectId === input.subject.id
      )
      return classMatches && subjectMatches
    })
  }
}
