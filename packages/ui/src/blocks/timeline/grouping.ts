export type TimelineDayTranslator = (key: string, fallback: string) => string

export type TimelineDayGroup<TItem extends { occurredAt: string }> = {
  dayKey: string
  label: string
  items: TItem[]
}

const TODAY_KEY = 'ui.blocks.timeline.today'
const YESTERDAY_KEY = 'ui.blocks.timeline.yesterday'

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function labelFor(date: Date, locale: string, now: Date, translate?: TimelineDayTranslator): string {
  const today = startOfDay(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const key = dayKeyOf(date)
  if (key === dayKeyOf(today)) return translate ? translate(TODAY_KEY, 'Today') : 'Today'
  if (key === dayKeyOf(yesterday)) return translate ? translate(YESTERDAY_KEY, 'Yesterday') : 'Yesterday'
  const sameYear = date.getFullYear() === today.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

export function groupTimelineByDay<TItem extends { occurredAt: string }>(
  items: readonly TItem[],
  locale: string,
  now: Date | number,
  translate?: TimelineDayTranslator,
): TimelineDayGroup<TItem>[] {
  const reference = typeof now === 'number' ? new Date(now) : now
  const groups: TimelineDayGroup<TItem>[] = []
  for (const item of items) {
    const date = new Date(item.occurredAt)
    const dayKey = Number.isNaN(date.getTime()) ? 'invalid' : dayKeyOf(date)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(item)
      continue
    }
    const label = dayKey === 'invalid' ? '' : labelFor(date, locale, reference, translate)
    groups.push({ dayKey, label, items: [item] })
  }
  return groups
}
