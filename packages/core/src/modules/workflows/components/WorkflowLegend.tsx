'use client'

import { Check, Play, Pause, Circle, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EDGE_COLORS, STATUS_COLORS, type EdgeState, type WorkflowStatus } from '../lib/status-colors'

/**
 * Legend rows are DERIVED from the same tables the canvas paints itself with
 * (`STATUS_COLORS` / `EDGE_COLORS`) rather than restating their colours. The
 * previous hand-written swatches used raw Tailwind shades and had drifted out
 * of sync, so the legend actively mis-described the canvas — it still showed a
 * dashed wire for the default route state after that route became solid.
 */
const STATUS_ROWS: { status: WorkflowStatus; icon: LucideIcon; labelKey: string }[] = [
  { status: 'completed', icon: Check, labelKey: 'workflows.legend.status.completed' },
  { status: 'in_progress', icon: Play, labelKey: 'workflows.legend.status.inProgress' },
  { status: 'pending', icon: Pause, labelKey: 'workflows.legend.status.pending' },
  { status: 'not_started', icon: Circle, labelKey: 'workflows.legend.status.notStarted' },
]

const EDGE_ROWS: { state: EdgeState; labelKey: string }[] = [
  { state: 'completed', labelKey: 'workflows.legend.edgeState.completed' },
  { state: 'pending', labelKey: 'workflows.legend.edgeState.pending' },
]

export function WorkflowLegend() {
  const t = useT()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          {t('workflows.legend.statusTitle')}
        </h3>
        <div className="space-y-2">
          {STATUS_ROWS.map(({ status, icon: Icon, labelKey }) => {
            const colors = STATUS_COLORS[status]
            return (
              <div key={status} className="flex items-center gap-2">
                <div
                  className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${colors.bg}`}
                >
                  <Icon className={`w-3 h-3 ${colors.icon}`} aria-hidden="true" />
                </div>
                <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          {t('workflows.legend.edgeStatesTitle')}
        </h3>
        <div className="space-y-2">
          {EDGE_ROWS.map(({ state, labelKey }) => {
            const colors = EDGE_COLORS[state]
            return (
              <div key={state} className="flex items-center gap-2">
                <div
                  className="flex-shrink-0 w-8"
                  style={{
                    height: colors.strokeWidth,
                    backgroundColor: colors.stroke,
                    backgroundImage: colors.dashed
                      ? `repeating-linear-gradient(to right, ${colors.stroke} 0, ${colors.stroke} 8px, transparent 8px, transparent 12px)`
                      : undefined,
                  }}
                />
                <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
