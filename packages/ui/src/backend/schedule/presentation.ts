import type { CSSProperties } from 'react'
import type { ScheduleItem } from './types'

type ScheduleStatusTone = 'success' | 'warning' | 'error' | 'neutral'

export function getScheduleStatusTone(status: ScheduleItem['status']): ScheduleStatusTone {
  if (status === 'confirmed') return 'success'
  if (status === 'negotiation') return 'warning'
  if (status === 'cancelled') return 'error'
  return 'neutral'
}

export function getScheduleItemStyle(item: ScheduleItem): CSSProperties {
  const tone = getScheduleStatusTone(item.status)
  return {
    backgroundColor: `color-mix(in srgb, var(--status-${tone}-icon) 8%, var(--card))`,
    borderColor: 'var(--border)',
    borderInlineStartColor: `var(--status-${tone}-border)`,
    color: 'var(--foreground)',
  }
}
