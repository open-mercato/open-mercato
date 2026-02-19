import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityClass } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ExtractedParticipant } from '../data/entities'

export interface MatchedContact {
  contactId: string
  contactType: 'person' | 'company'
  contactName: string
  confidence: number
}

export interface ContactMatchResult {
  participant: ExtractedParticipant
  match: MatchedContact | null
}

interface MatcherScope {
  tenantId: string
  organizationId: string
  encryptionService?: unknown
}

interface CustomerEntityLike {
  id: string
  kind: string
  displayName: string
  primaryEmail?: string | null
  tenantId?: string
  organizationId?: string
  deletedAt?: Date | null
  createdAt?: Date
}

export async function matchContacts(
  em: EntityManager,
  participants: { name: string; email: string; role: string }[],
  scope: MatcherScope,
  deps?: { customerEntityClass: EntityClass<CustomerEntityLike> },
): Promise<ContactMatchResult[]> {
  const results: ContactMatchResult[] = []
  const entityClass = deps?.customerEntityClass

  if (!entityClass) return participants.map((p) => ({
    participant: {
      name: p.name,
      email: p.email,
      role: p.role as ExtractedParticipant['role'],
      matchedContactId: null,
      matchedContactType: null,
    },
    match: null,
  }))

  for (const participant of participants) {
    const match = await matchSingleContact(em, participant, scope, entityClass)
    results.push({
      participant: {
        name: participant.name,
        email: participant.email,
        role: participant.role as ExtractedParticipant['role'],
        matchedContactId: match?.contactId || null,
        matchedContactType: match?.contactType || null,
        matchConfidence: match?.confidence,
      },
      match,
    })
  }

  return results
}

async function matchSingleContact(
  em: EntityManager,
  participant: { name: string; email: string },
  scope: MatcherScope,
  entityClass: EntityClass<CustomerEntityLike>,
): Promise<MatchedContact | null> {
  if (!participant.email && !participant.name) return null

  if (participant.email) {
    const emailMatch = await findOneWithDecryption(
      em,
      entityClass,
      {
        primaryEmail: participant.email.toLowerCase(),
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { orderBy: { createdAt: 'DESC' } },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (emailMatch) {
      return {
        contactId: emailMatch.id,
        contactType: emailMatch.kind === 'company' ? 'company' : 'person',
        contactName: emailMatch.displayName || participant.name,
        confidence: 1.0,
      }
    }
  }

  if (participant.name && participant.name.length >= 2) {
    const nameResults = await findWithDecryption(
      em,
      entityClass,
      {
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      { limit: 100, orderBy: { createdAt: 'DESC' } },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    const normalizedSearch = participant.name.toLowerCase().trim()
    let bestMatch: { entity: CustomerEntityLike; score: number } | null = null

    for (const entity of nameResults) {
      const displayName = (entity.displayName || '').toLowerCase().trim()
      if (!displayName) continue

      let score = 0
      if (displayName === normalizedSearch) {
        score = 1.0
      } else if (displayName.startsWith(normalizedSearch) || normalizedSearch.startsWith(displayName)) {
        score = 0.9
      } else if (displayName.includes(normalizedSearch) || normalizedSearch.includes(displayName)) {
        score = 0.7
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { entity, score }
      }
    }

    if (bestMatch && bestMatch.score >= 0.7) {
      return {
        contactId: bestMatch.entity.id,
        contactType: bestMatch.entity.kind === 'company' ? 'company' : 'person',
        contactName: bestMatch.entity.displayName || participant.name,
        confidence: bestMatch.score,
      }
    }
  }

  return null
}
