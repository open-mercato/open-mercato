import type { EntityManager } from '@mikro-orm/postgresql'
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

export async function matchContacts(
  em: EntityManager,
  participants: { name: string; email: string; role: string }[],
  scope: MatcherScope,
): Promise<ContactMatchResult[]> {
  const results: ContactMatchResult[] = []

  for (const participant of participants) {
    const match = await matchSingleContact(em, participant, scope)
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
): Promise<MatchedContact | null> {
  if (!participant.email && !participant.name) return null

  // Step 1: Exact email match (highest confidence)
  if (participant.email) {
    const emailMatch = await findOneWithDecryption(
      em,
      'CustomerEntity' as any,
      {
        primaryEmail: participant.email.toLowerCase(),
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      } as any,
      { orderBy: { createdAt: 'DESC' } as any },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    if (emailMatch) {
      return {
        contactId: (emailMatch as any).id,
        contactType: (emailMatch as any).kind === 'company' ? 'company' : 'person',
        contactName: (emailMatch as any).displayName || participant.name,
        confidence: 1.0,
      }
    }
  }

  // Step 2: Fuzzy name search (medium confidence)
  if (participant.name && participant.name.length >= 2) {
    const nameResults = await findWithDecryption(
      em,
      'CustomerEntity' as any,
      {
        deletedAt: null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      } as any,
      { limit: 10, orderBy: { createdAt: 'DESC' } as any },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    const normalizedSearch = participant.name.toLowerCase().trim()
    let bestMatch: { entity: any; score: number } | null = null

    for (const entity of nameResults) {
      const displayName = ((entity as any).displayName || '').toLowerCase().trim()
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
