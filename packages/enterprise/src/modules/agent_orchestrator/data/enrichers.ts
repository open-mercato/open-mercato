import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { resolveVerifiedProposalIds } from '../lib/identity/actionAgentAttribution'
import { readAuditEntryAnchors } from '../lib/identity/auditEntryLinks'

/**
 * Marks each core audit-log action row with whether the proposal id it carries is
 * backed by a server record (`_agent_orchestrator.proposalVerified`), so the
 * "Open proposal" row action is offered only for a verified proposal. The id on an
 * effector write comes from the user-writable workflow context; see
 * `resolveVerifiedProposalIds` for the rule.
 *
 * The output depends on proposal rows the audit list never invalidates on, so it
 * re-runs on every request (`cacheableOnListHit: false`).
 */

type AuditActionRecord = Record<string, unknown> & { id: string }

export type AuditActionProposalEnrichment = {
  _agent_orchestrator: { proposalVerified: boolean }
}

const UNVERIFIED: AuditActionProposalEnrichment = { _agent_orchestrator: { proposalVerified: false } }

async function markProposalVerification<T extends AuditActionRecord>(
  records: T[],
  context: EnricherContext,
): Promise<Array<T & AuditActionProposalEnrichment>> {
  const unverified = () => records.map((record) => ({ ...record, ...UNVERIFIED }))
  if (records.length === 0 || !context.tenantId) return unverified()
  const anchors = records.map((record) => readAuditEntryAnchors(record))
  if (!anchors.some((anchor) => anchor.proposalId)) return unverified()
  const em = (context.em as EntityManager).fork()
  const verified = await resolveVerifiedProposalIds(
    em,
    { tenantId: context.tenantId, organizationId: context.organizationId || null },
    anchors,
  )
  return records.map((record, index) => ({
    ...record,
    _agent_orchestrator: { proposalVerified: verified[index] !== null },
  }))
}

export const auditActionProposalEnricher: ResponseEnricher<AuditActionRecord, AuditActionProposalEnrichment> = {
  id: 'agent_orchestrator.audit-action-proposal-verification',
  targetEntity: 'audit_logs.action_log',
  features: ['agent_orchestrator.proposals.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  cacheableOnListHit: false,
  fallback: UNVERIFIED,

  async enrichOne(record, context) {
    const [enriched] = await markProposalVerification([record], context)
    return enriched
  },

  async enrichMany(records, context) {
    return markProposalVerification(records, context)
  },
}

export const enrichers: ResponseEnricher[] = [auditActionProposalEnricher]
