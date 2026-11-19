import type { FilterQuery } from '@mikro-orm/core'
import type { DomainMapping, DomainStatus } from '../data/entities'

const DAY_MS = 24 * 60 * 60 * 1000
const VERIFICATION_WINDOW_MS = 2 * DAY_MS
const TXT_PREFIX = '_om-verify.'

export const DOMAIN_RESERVATION_MS = 7 * DAY_MS
export const MAX_DOMAINS_PER_ORG = 2
export const MAX_VERIFIABLE_HOSTNAME_LENGTH = 253 - TXT_PREFIX.length
export const DOMAIN_UNAVAILABLE_MESSAGE = 'This domain is not available. Please choose a different hostname.'
export const DOMAIN_LIMIT_MESSAGE = `Each organization can have at most ${MAX_DOMAINS_PER_ORG} custom domains (one active and one pending replacement). Remove an existing domain or finish the swap first.`
export const DOMAIN_OWNERSHIP_UNVERIFIED = 'domain_ownership_txt_unverified'
export const UNVERIFIED_DOMAIN_STATUSES: DomainStatus[] = ['pending', 'dns_failed']

export function domainVerificationCutoff(now = new Date()): Date {
  return new Date(now.getTime() - VERIFICATION_WINDOW_MS)
}

export function domainVerificationDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + VERIFICATION_WINDOW_MS)
}

export function liveDomainMappings(now = new Date()) {
  return {
    deletedAt: null,
    $or: [
      { status: { $nin: UNVERIFIED_DOMAIN_STATUSES } },
      { createdAt: { $gt: domainVerificationCutoff(now) } },
    ],
  } satisfies FilterQuery<DomainMapping>
}

export function domainOwnershipRecord(mapping: Pick<DomainMapping, 'id' | 'hostname'>) {
  return { name: `${TXT_PREFIX}${mapping.hostname}`, value: `open-mercato-verification=${mapping.id}` }
}
