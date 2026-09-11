'use client'

import { Bot, Clock, CornerDownLeft, Database, Filter, FunctionSquare, Globe, Mail, Radio, Variable, Webhook, Workflow, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import '../lib/activity-registry-bootstrap'
import { getActivityType } from '../lib/activity-registry'
import type { RouteChipModel, RouteChipSection } from '../lib/route-chips'
import { ROUTE_CHIP_CLASS, ROUTE_CHIP_ICON_CLASS, ROUTE_CHIP_LABEL_ICON_CLASS } from '../lib/node-geometry'

/**
 * Icon names the activity registry declares (`ActivityTypeEntry.icon`) mapped to
 * their lucide components. Kept as an explicit map — a dynamic `lucide[name]`
 * lookup would pull the whole icon set into the editor chunk (#3169).
 */
const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  Mail,
  Radio,
  Database,
  Webhook,
  FunctionSquare,
  Clock,
  Globe,
  Variable,
  Bot,
}

export function resolveActivityIcon(activityType: string): LucideIcon {
  const entry = getActivityType(activityType)
  return (entry && ACTIVITY_ICONS[entry.icon]) || Workflow
}

export type WorkflowRouteChipsProps = {
  model: RouteChipModel
  /** Canvas zoom; below the semantic-zoom threshold the caller passes `collapsed`. */
  collapsed?: boolean
  onOpenSection?: (section: RouteChipSection) => void
  /**
   * Open the focused single-activity modal for one activity chip. When omitted,
   * an activity chip falls back to `onOpenSection('activities')` (the full
   * transition inspector), preserving the pre-existing behavior.
   */
  onOpenActivity?: (activityId: string) => void
}

/**
 * WorkflowRouteChips — the condition / activity / otherwise chip row a
 * transition renders along its edge (spec section 4.4, issue #4244).
 *
 * Density management: activity chips cap at `ROUTE_CHIP_LIMIT` with a `+N`
 * overflow badge, and below the semantic-zoom threshold the whole row collapses
 * to dots so a 60-node flow stays navigable. Every chip is a button with an
 * accessible label and an icon, never colour alone.
 */
export function WorkflowRouteChips({ model, collapsed = false, onOpenSection, onOpenActivity }: WorkflowRouteChipsProps) {
  const t = useT()

  if (model.isEmpty) return null

  const dotCount = (model.conditionSummary ? 1 : 0) + model.activities.length + model.overflowCount + (model.isOtherwise ? 1 : 0)

  if (collapsed) {
    return (
      <div
        className="flex items-center gap-0.5"
        role="img"
        aria-label={t('workflows.routeChips.collapsed', { count: dotCount })}
        data-testid="route-chips-collapsed"
      >
        {Array.from({ length: Math.min(dotCount, 5) }).map((_, index) => (
          <span key={index} className="size-1.5 rounded-full bg-muted-foreground" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" data-testid="route-chips">
      {model.conditionSummary ? (
        <button
          type="button"
          className={`${ROUTE_CHIP_CLASS} border-border text-foreground hover:border-primary`}
          aria-label={t('workflows.routeChips.conditionLabel', { summary: model.conditionSummary })}
          onClick={(event) => {
            // The chip lives in ReactFlow's EdgeLabelRenderer portal; a synthetic
            // click bubbles through the React tree to the edge wrapper and would
            // also fire onEdgeClick (opening the full transition editor). Stop it
            // so a chip opens only its own surface.
            event.stopPropagation()
            onOpenSection?.('condition')
          }}
        >
          <Filter className={`${ROUTE_CHIP_LABEL_ICON_CLASS} shrink-0`} aria-hidden="true" />
          <span className="font-mono">{model.conditionSummary}</span>
        </button>
      ) : null}

      {model.isOtherwise ? (
        <span
          className={`${ROUTE_CHIP_CLASS} border-dashed border-border text-muted-foreground`}
          data-testid="route-chip-otherwise"
        >
          <CornerDownLeft className={`${ROUTE_CHIP_LABEL_ICON_CLASS} shrink-0`} aria-hidden="true" />
          {t('workflows.routeChips.otherwise')}
        </span>
      ) : null}

      {model.activities.map((activity) => {
        const Icon = resolveActivityIcon(activity.activityType)
        const entry = getActivityType(activity.activityType)
        const label = entry ? t(entry.i18nKey) : activity.activityType
        return (
          <button
            key={activity.activityId}
            type="button"
            className={`${ROUTE_CHIP_CLASS} border-border text-muted-foreground hover:border-primary hover:text-foreground`}
            aria-label={t('workflows.routeChips.activityLabel', { activity: label })}
            title={label}
            onClick={(event) => {
              event.stopPropagation()
              if (onOpenActivity) onOpenActivity(activity.activityId)
              else onOpenSection?.('activities')
            }}
          >
            <Icon className={`${ROUTE_CHIP_ICON_CLASS} shrink-0`} aria-hidden="true" />
          </button>
        )
      })}

      {model.overflowCount > 0 ? (
        <button
          type="button"
          className={`${ROUTE_CHIP_CLASS} border-border text-muted-foreground hover:border-primary`}
          aria-label={t('workflows.routeChips.overflowLabel', { count: model.overflowCount })}
          onClick={(event) => {
            event.stopPropagation()
            onOpenSection?.('activities')
          }}
          data-testid="route-chip-overflow"
        >
          +{model.overflowCount}
        </button>
      ) : null}
    </div>
  )
}
