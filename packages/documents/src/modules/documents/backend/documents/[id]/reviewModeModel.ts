import type { CSSProperties } from 'react'
import { FINDING_SEVERITIES, groupFindings, type DocumentFindingItem, type FindingSeverity, type FindingSummary } from './findingModel'

export type ReleaseGateState =
  | { kind: 'blocked'; blocking: number }
  | { kind: 'ready' }

export type ReviewSummaryLine =
  | { kind: 'coverage'; sections: number; rules: number; references: number }
  | { kind: 'fallback'; reviewedAt: string | null; playbookName: string | null; playbookVersion: number | null }

export function isReviewMode(summary: FindingSummary | null): summary is FindingSummary & { reviewId: string } {
  return Boolean(summary && summary.reviewId)
}

export function releaseGateState(summary: FindingSummary | null): ReleaseGateState | null {
  if (!isReviewMode(summary)) return null
  return summary.open.blocking > 0 ? { kind: 'blocked', blocking: summary.open.blocking } : { kind: 'ready' }
}

export function reviewSummaryLine(summary: FindingSummary, sections: number | null): ReviewSummaryLine {
  const { rules, references } = summary.coverage
  if (sections !== null && sections > 0 && rules !== null && references !== null) {
    return { kind: 'coverage', sections, rules, references }
  }
  return {
    kind: 'fallback',
    reviewedAt: summary.reviewedAt,
    playbookName: summary.playbook?.name ?? null,
    playbookVersion: summary.playbook?.version ?? null,
  }
}

export function firstOpenFindingId(
  findings: DocumentFindingItem[],
  severities: readonly FindingSeverity[] = FINDING_SEVERITIES,
): string | null {
  const groups = groupFindings(findings)
  for (const severity of severities) {
    const first = groups[severity][0]
    if (first) return first.id
  }
  return null
}

export function isFindingCardExpanded(
  findingId: string,
  defaults: { firstOpenId: string | null; activeId: string | null },
  overrides: Readonly<Record<string, boolean>>,
): boolean {
  const override = overrides[findingId]
  if (override !== undefined) return override
  return findingId === defaults.firstOpenId || findingId === defaults.activeId
}

export function countSectionHeadings(nodes: Iterable<{ typeName: string; text: string }>): number {
  let sections = 0
  for (const node of nodes) {
    if (node.typeName === 'heading' && node.text.trim().length > 0) sections += 1
  }
  return sections
}

const APP_MAIN_MAX_WIDTH = '1536px'
const APP_MAIN_INLINE_PADDING = '3rem'

/**
 * Full-bleed review workspace: spans the backend content column instead of
 * `main`'s centered max-width, using the `--app-content-offset` the AppShell
 * exposes for full-bleed pages. Keeps `main`'s side padding as the gutter.
 */
export function reviewWorkspaceStyle(): CSSProperties {
  const overflow = `max(0px, (100vw - var(--app-content-offset, 0px) - ${APP_MAIN_MAX_WIDTH}) / 2)`
  return {
    width: `calc(100vw - var(--app-content-offset, 0px) - ${APP_MAIN_INLINE_PADDING})`,
    marginLeft: `calc(-1 * ${overflow})`,
    marginRight: `calc(-1 * ${overflow})`,
  }
}
