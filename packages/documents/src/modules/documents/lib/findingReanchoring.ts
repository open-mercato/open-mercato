import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentFinding } from '../data/entities'
import { createFindingAnchorer, type FindingAnchorResult } from './findingAnchors'

export type FindingReanchorScope = { tenantId: string; organizationId: string }

export type FindingReanchorResult = {
  checked: number
  changed: number
  located: number
  unlocated: number
}

function anchorKey(anchor: Record<string, unknown> | null | undefined, status: string): string {
  return JSON.stringify({ status, anchor: anchor ?? null })
}

function resultKey(result: FindingAnchorResult): string {
  return anchorKey(result.anchorStatus === 'located' ? result.anchor : null, result.anchorStatus)
}

/**
 * Re-anchor a document's open findings against a Yjs state that replaced the
 * previous one non-incrementally (REST content replace, version restore).
 * Stored relative positions point at structs of the previous CRDT epoch and
 * collapse once those structs are tombstoned or dropped, so every open finding
 * is located again from its quote, occurrence and section label.
 *
 * The anchor is a derived projection of the document text, not decision
 * state: rows are written with a native update so `updatedAt` (the finding's
 * optimistic-lock token and undo guard) is left untouched. Callers MUST run
 * this inside the same transaction that writes the new Yjs state and after
 * the document aggregate root is locked.
 */
export async function reanchorOpenFindings(
  em: EntityManager,
  documentId: string,
  scope: FindingReanchorScope,
  yjsState: Buffer | Uint8Array | null | undefined,
): Promise<FindingReanchorResult> {
  const findings = await findWithDecryption(
    em,
    DocumentFinding,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status: 'open',
      deletedAt: null,
    },
    { disableIdentityMap: true },
    scope,
  )
  const result: FindingReanchorResult = { checked: findings.length, changed: 0, located: 0, unlocated: 0 }
  if (findings.length === 0) return result
  const anchorer = createFindingAnchorer(yjsState)
  try {
    for (const finding of findings) {
      const located = anchorer.locate({
        quote: finding.quote,
        occurrence: finding.occurrence,
        sectionLabel: finding.sectionLabel ?? null,
      })
      if (located.anchorStatus === 'located') result.located += 1
      else result.unlocated += 1
      if (resultKey(located) === anchorKey(finding.anchor, finding.anchorStatus)) continue
      const affected = await em.nativeUpdate(
        DocumentFinding,
        {
          id: finding.id,
          documentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          status: 'open',
          deletedAt: null,
        },
        {
          anchor: located.anchorStatus === 'located' ? located.anchor : null,
          anchorStatus: located.anchorStatus,
        },
      )
      if (affected === 1) result.changed += 1
    }
  } finally {
    anchorer.dispose()
  }
  return result
}
