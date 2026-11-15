"use client"

import * as React from 'react'
import { AlertTriangle, FileText, Users, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

export type ProjectsBulkActionsLabels = {
  selectedCount: string
  report: string
  assignMembers: string
  clear: string
}

export type ProjectsBulkActionsBarProps = {
  selectedCount: number
  labels: ProjectsBulkActionsLabels
  canReport: boolean
  canAssignMembers: boolean
  reportBlockedReason: string | null
  isBusy?: boolean
  onReport: () => void
  onAssignMembers: () => void
  onClear: () => void
}

/**
 * Bulk actions live inline in the toolbar row (screen 3 note 3), never in a
 * floating bar. "Report from selected" stays visible but disabled while the
 * selection spans more than one customer or currency, with the reason spelled
 * out next to it (screen 3 note 4) rather than failing silently on click.
 */
export function ProjectsBulkActionsBar({
  selectedCount,
  labels,
  canReport,
  canAssignMembers,
  reportBlockedReason,
  isBusy = false,
  onReport,
  onAssignMembers,
  onClear,
}: ProjectsBulkActionsBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="projects-bulk-actions">
      <span className="text-sm text-muted-foreground">{labels.selectedCount}</span>
      {canReport ? (
        <Button
          type="button"
          variant="outline"
          disabled={isBusy || reportBlockedReason !== null}
          onClick={onReport}
          data-testid="projects-bulk-report"
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span>{labels.report}</span>
        </Button>
      ) : null}
      {canAssignMembers ? (
        <Button
          type="button"
          variant="outline"
          disabled={isBusy}
          onClick={onAssignMembers}
          data-testid="projects-bulk-assign-members"
        >
          <Users className="h-4 w-4 shrink-0" aria-hidden />
          <span>{labels.assignMembers}</span>
        </Button>
      ) : null}
      <Button type="button" variant="ghost" disabled={isBusy} onClick={onClear}>
        <X className="h-4 w-4 shrink-0" aria-hidden />
        <span>{labels.clear}</span>
      </Button>
      {canReport && reportBlockedReason ? (
        <span
          className="flex items-center gap-1.5 rounded-md border border-status-warning-border bg-status-warning-bg px-2 py-1 text-xs text-status-warning-text"
          role="status"
          data-testid="projects-bulk-report-blocked"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {reportBlockedReason}
        </span>
      ) : null}
    </div>
  )
}

export default ProjectsBulkActionsBar
