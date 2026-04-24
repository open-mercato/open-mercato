import type { KpiTrend } from '@open-mercato/ui/backend/charts/KpiCard'
import type { DealSummary, InteractionSummary, TodoLinkSummary } from '../../formConfig'

export function sumActiveDeals(deals: DealSummary[]): number {
  return deals
    .filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
    .reduce((sum, d) => {
      const amount = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amount) ? amount : 0)
    }, 0)
}

export function getActiveDeals(deals: DealSummary[]): DealSummary[] {
  return deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
}

export function getOpenTasks(todos: TodoLinkSummary[]): TodoLinkSummary[] {
  return todos.filter((t) => !t.isDone).sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return 0
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  })
}

export function getUpcomingMeetings(interactions: InteractionSummary[]): InteractionSummary[] {
  const now = new Date()
  return interactions
    .filter((i) => i.scheduledAt && new Date(i.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 3)
}

export function getRecentActivity(interactions: InteractionSummary[]): InteractionSummary[] {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  return interactions
    .filter((i) => {
      const date = i.occurredAt ?? i.scheduledAt
      return date && new Date(date) >= weekAgo
    })
    .sort((a, b) => {
      const da = a.occurredAt ?? a.scheduledAt ?? ''
      const db = b.occurredAt ?? b.scheduledAt ?? ''
      return new Date(db).getTime() - new Date(da).getTime()
    })
    .slice(0, 4)
}

export function computeActivityTrend(interactions: InteractionSummary[]): KpiTrend | undefined {
  const now = Date.now()
  const weekMs = 7 * 86_400_000
  const thisWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    return d && now - new Date(d).getTime() < weekMs
  }).length
  const lastWeek = interactions.filter((i) => {
    const d = i.occurredAt ?? i.scheduledAt
    if (!d) return false
    const diff = now - new Date(d).getTime()
    return diff >= weekMs && diff < weekMs * 2
  }).length
  if (lastWeek === 0 && thisWeek === 0) return undefined
  if (lastWeek === 0) return { value: 100, direction: 'up' }
  const pct = ((thisWeek - lastWeek) / lastWeek) * 100
  if (Math.abs(pct) < 0.5) return { value: 0, direction: 'unchanged' }
  return { value: Math.abs(pct), direction: pct > 0 ? 'up' : 'down' }
}

export function computeDealTrend(deals: DealSummary[]): KpiTrend | undefined {
  const active = deals.filter((d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'closed')
  if (active.length === 0) return undefined
  const now = Date.now()
  const monthMs = 30 * 86_400_000
  const recentDeals = active.filter((d) => d.createdAt && now - new Date(d.createdAt).getTime() < monthMs).length
  if (recentDeals > 0) return { value: recentDeals * 10, direction: 'up' }
  return { value: 0, direction: 'unchanged' }
}
