import type { FindingSeverity, MockupLeafNode, MockupStatus } from '../schema'
import type { MockupDiffTone } from '../diff'

/**
 * The annotation visual language (spec 2026-07-05-ds-live-mockup-composer.md):
 * review-margin, not markup-on-content. A slim status rail in the block margin
 * (the sanctioned `border-l-4 border-status-*-border` pattern) plus dot-label
 * ledger entries — content is never outlined, badged, or dimmed.
 *
 * `proposed` deliberately reuses the brand-violet 10/30/100 pattern (the DS's
 * "user-created/custom" language, `.ai/ds-rules.md`) rather than a status
 * color: a proposal is not a warning, and the DS forbids amber chips.
 */

export type MockupLedgerStatus = MockupStatus | 'placeholder'

export function ledgerStatusOf(leaf: MockupLeafNode): MockupLedgerStatus {
  return leaf.type === 'placeholder' ? 'placeholder' : leaf.status
}

/** Margin rail — `border-l-4` + status border token; brand-violet for proposals. */
export const STATUS_RAIL_CLASS: Record<MockupLedgerStatus, string> = {
  implemented: 'border-l-4 border-status-success-border',
  'om-default': 'border-l-4 border-status-neutral-border',
  proposed: 'border-l-4 border-brand-violet/30',
  placeholder: 'border-l-4 border-dashed border-border',
}

/** Ledger dot per status. */
export const STATUS_DOT_CLASS: Record<MockupLedgerStatus, string> = {
  implemented: 'bg-status-success-icon',
  'om-default': 'bg-status-neutral-icon',
  proposed: 'bg-brand-violet',
  placeholder: 'bg-muted-foreground',
}

/** Ledger count chips — 6px radius (`rounded-sm`), never pills. */
export const STATUS_CHIP_CLASS: Record<MockupLedgerStatus, string> = {
  implemented: 'border-status-success-border bg-status-success-bg text-status-success-text',
  'om-default': 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
  proposed: 'border-brand-violet/30 bg-brand-violet/10 text-brand-violet',
  placeholder: 'border-dashed border-border bg-muted/30 text-muted-foreground',
}

export const STATUS_LABELS: Record<MockupLedgerStatus, { key: string; fallback: string }> = {
  implemented: { key: 'design_system.mockups.status.implemented', fallback: 'Implemented' },
  proposed: { key: 'design_system.mockups.status.proposed', fallback: 'Proposed' },
  'om-default': { key: 'design_system.mockups.status.omDefault', fallback: 'Platform default' },
  placeholder: { key: 'design_system.mockups.status.placeholder', fallback: 'Placeholder' },
}

export const LEDGER_STATUS_ORDER: MockupLedgerStatus[] = [
  'implemented',
  'proposed',
  'om-default',
  'placeholder',
]

// ---------------------------------------------------------------------------
// Findings (Phase 2) — same margin-rail-and-ledger language as statuses, so
// there is one annotation system, not two. Severity tones per the spec:
// critical/high → status-error, medium → status-info, low → status-neutral.
// ---------------------------------------------------------------------------

/** Short severity segment in the margin gutter beside the status rail. */
export const SEVERITY_SEGMENT_CLASS: Record<FindingSeverity, string> = {
  critical: 'bg-status-error-icon',
  high: 'bg-status-error-icon',
  medium: 'bg-status-info-icon',
  low: 'bg-status-neutral-icon',
}

/** Ledger dot per severity. */
export const SEVERITY_DOT_CLASS: Record<FindingSeverity, string> = {
  critical: 'bg-status-error-icon',
  high: 'bg-status-error-icon',
  medium: 'bg-status-info-icon',
  low: 'bg-status-neutral-icon',
}

export const SEVERITY_LABELS: Record<FindingSeverity, { key: string; fallback: string }> = {
  critical: { key: 'design_system.mockups.severity.critical', fallback: 'Critical' },
  high: { key: 'design_system.mockups.severity.high', fallback: 'High' },
  medium: { key: 'design_system.mockups.severity.medium', fallback: 'Medium' },
  low: { key: 'design_system.mockups.severity.low', fallback: 'Low' },
}

export const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low']

// ---------------------------------------------------------------------------
// Diff (Phase 2) — the same rail vocabulary: added → success, removed → error,
// changed → info, moved-only → neutral. Never frames around content.
// ---------------------------------------------------------------------------

export const DIFF_RAIL_CLASS: Record<MockupDiffTone, string> = {
  added: 'border-l-4 border-status-success-border',
  removed: 'border-l-4 border-status-error-border',
  changed: 'border-l-4 border-status-info-border',
  moved: 'border-l-4 border-status-neutral-border',
}

export const DIFF_DOT_CLASS: Record<MockupDiffTone, string> = {
  added: 'bg-status-success-icon',
  removed: 'bg-status-error-icon',
  changed: 'bg-status-info-icon',
  moved: 'bg-status-neutral-icon',
}

export const DIFF_LABELS: Record<MockupDiffTone, { key: string; fallback: string }> = {
  added: { key: 'design_system.mockups.diff.added', fallback: 'Added' },
  removed: { key: 'design_system.mockups.diff.removed', fallback: 'Removed' },
  changed: { key: 'design_system.mockups.diff.changed', fallback: 'Changed' },
  moved: { key: 'design_system.mockups.diff.moved', fallback: 'Moved' },
}

export const DIFF_TONE_ORDER: MockupDiffTone[] = ['added', 'removed', 'changed', 'moved']
