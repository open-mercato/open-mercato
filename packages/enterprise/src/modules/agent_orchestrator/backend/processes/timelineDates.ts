import type { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDate, formatDisplayTime, todayInZone, type DisplaySettings } from '@open-mercato/ui/primitives/date-format'

export function formatTimelineTimestamp(iso: string | null, locale: string, settings: DisplaySettings): { day: string; time: string } {
  if (!iso) return { day: '', time: '' }
  const parsed = new Date(iso)
  return {
    day: Number.isNaN(parsed.getTime()) ? iso.slice(0, 10) : todayInZone(settings.timeZone, parsed),
    time: formatDisplayTime(iso, locale, settings) ?? '',
  }
}

export function timelineDayLabel(
  dayKey: string,
  t: ReturnType<typeof useT>,
  locale: string,
  settings: DisplaySettings,
  now: Date = new Date(),
): string {
  const today = todayInZone(settings.timeZone, now)
  const previousDay = new Date(`${today}T12:00:00Z`)
  previousDay.setUTCDate(previousDay.getUTCDate() - 1)
  const yesterday = previousDay.toISOString().slice(0, 10)
  if (dayKey === today) return t('agent_orchestrator.process.today')
  if (dayKey === yesterday) return t('agent_orchestrator.process.yesterday')
  return formatDisplayDate(dayKey, locale, settings) ?? dayKey
}
