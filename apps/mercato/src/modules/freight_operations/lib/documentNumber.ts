import type { EntityManager } from '@mikro-orm/postgresql'
import type { DocumentSequenceKind } from '../data/entities'
import type { FreightSettings } from './freightSettings'

type Scope = { tenantId: string; organizationId: string }

const MAX_SEQUENCE = 1_000_000_000
const SEQUENCE_PAD = 5

export function numberPrefix(kind: DocumentSequenceKind, settings: FreightSettings): string {
  switch (kind) {
    case 'order':
      return settings.orderNumberPrefix
    case 'contract':
      return settings.contractNumberPrefix
    case 'trip':
      return settings.tripNumberPrefix
    case 'abstract':
      return settings.abstractNumberPrefix
  }
}

export function formatDocumentNumber(kind: DocumentSequenceKind, sequence: number, settings: FreightSettings): string {
  const value = Math.min(Math.max(Math.floor(sequence), 1), MAX_SEQUENCE)
  return `${numberPrefix(kind, settings)}-${String(value).padStart(SEQUENCE_PAD, '0')}`
}

/**
 * Claim the next per-kind sequence value. The upsert row-locks the counter, so
 * two concurrent creates cannot read the same value; the partial unique index on
 * the document number is the backstop. A failed transaction may skip a number —
 * acceptable, as the financial numbering spec already rules.
 */
export async function allocateDocumentNumber(
  em: EntityManager,
  scope: Scope,
  kind: DocumentSequenceKind,
  settings: FreightSettings,
): Promise<string> {
  const rows = await em.getConnection().execute<{ current_value: number | string }[]>(
    `
      insert into freight_document_sequences (id, organization_id, tenant_id, kind, current_value, created_at, updated_at)
      values (gen_random_uuid(), ?, ?, ?, 1, now(), now())
      on conflict (organization_id, tenant_id, kind)
      do update set current_value = freight_document_sequences.current_value + 1, updated_at = now()
      returning current_value
    `,
    [scope.organizationId, scope.tenantId, kind],
  )
  const value = Number(rows?.[0]?.current_value ?? 1)
  const sequence = Number.isFinite(value) && value >= 1 ? value : 1
  return formatDocumentNumber(kind, sequence, settings)
}
