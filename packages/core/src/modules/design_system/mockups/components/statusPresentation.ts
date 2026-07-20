import type { MockupLeafNode, MockupStatus } from '../schema'

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
