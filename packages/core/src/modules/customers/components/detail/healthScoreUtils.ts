/**
 * Shared health score computation for CRM relationship health widgets.
 */
import type { InteractionSummary } from '../formConfig'

export type HealthVariant = 'success' | 'warning' | 'error'

export type HealthScore = {
  score: number
  label: string
  variant: HealthVariant
  lastContactDays: number | null
}

export function computeHealthScore(interactions: InteractionSummary[]): HealthScore {
  const now = Date.now()
  const dayMs = 86_400_000

  const dates = interactions
    .map((i) => i.occurredAt ?? i.scheduledAt)
    .filter(Boolean)
    .map((d) => new Date(d!).getTime())
  const lastContactMs = dates.length > 0 ? Math.max(...dates) : 0
  const daysSinceContact = lastContactMs > 0 ? Math.floor((now - lastContactMs) / dayMs) : 999

  let recencyScore: number
  if (daysSinceContact <= 7) recencyScore = 100
  else if (daysSinceContact <= 30) recencyScore = 75
  else if (daysSinceContact <= 60) recencyScore = 50
  else if (daysSinceContact <= 90) recencyScore = 25
  else recencyScore = 0

  const last30 = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    return d && now - new Date(d).getTime() < 30 * dayMs
  }).length

  let frequencyScore: number
  if (last30 >= 5) frequencyScore = 100
  else if (last30 >= 3) frequencyScore = 75
  else if (last30 >= 1) frequencyScore = 50
  else frequencyScore = 0

  const types = new Set(interactions.map((i) => i.interactionType))
  let diversityScore: number
  if (types.size >= 4) diversityScore = 100
  else if (types.size >= 3) diversityScore = 75
  else if (types.size >= 2) diversityScore = 50
  else if (types.size >= 1) diversityScore = 25
  else diversityScore = 0

  const weekBuckets = new Set(
    interactions
      .map((i) => i.occurredAt ?? i.scheduledAt)
      .filter(Boolean)
      .map((d) => Math.floor(new Date(d!).getTime() / (7 * dayMs))),
  )
  let consistencyScore: number
  if (weekBuckets.size >= 8) consistencyScore = 100
  else if (weekBuckets.size >= 4) consistencyScore = 75
  else if (weekBuckets.size >= 2) consistencyScore = 50
  else consistencyScore = 25

  const score = Math.round(
    recencyScore * 0.4 + frequencyScore * 0.3 + diversityScore * 0.15 + consistencyScore * 0.15,
  )

  let label: string
  let variant: HealthVariant
  if (score >= 70) { label = 'healthy'; variant = 'success' }
  else if (score >= 40) { label = 'watchful'; variant = 'warning' }
  else { label = 'at risk'; variant = 'error' }

  return { score, label, variant, lastContactDays: daysSinceContact < 999 ? daysSinceContact : null }
}

/**
 * Shared health variant → semantic status token mappings.
 * Used by RelationshipHealthCard and RelationshipHealthWidget.
 */
export const HEALTH_ICON_CLASSES: Record<HealthVariant, string> = {
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  error: 'text-status-error-icon',
}

export const HEALTH_BADGE_CLASSES: Record<HealthVariant, string> = {
  success: 'bg-status-success-bg text-status-success-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  error: 'bg-status-error-bg text-status-error-text',
}
