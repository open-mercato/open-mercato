export type AvailabilityRepeat = 'once' | 'daily' | 'weekly'

export type AvailabilityRuleWindow = {
  startAt: Date
  endAt: Date
  repeat: AvailabilityRepeat
}

export type AvailabilityRuleLike = {
  id: string
  rrule: string
  createdAt?: string | Date | null
  kind?: 'availability' | 'unavailability'
  note?: string | null
  exdates?: string[]
}

export function parseAvailabilityRuleWindow(rule: AvailabilityRuleLike): AvailabilityRuleWindow {
  const dtStartMatch = rule.rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.rrule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.rrule.match(/FREQ=([A-Z]+)/)
  const countMatch = rule.rrule.match(/COUNT=(\d+)/)
  let start = new Date()
  if (dtStartMatch?.[1]) {
    const raw = dtStartMatch[1].replace(/Z$/, '')
    const parts = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
    if (parts) {
      const [, year, month, day, hour, minute, second] = parts
      const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
      const parsed = new Date(iso)
      if (!Number.isNaN(parsed.getTime())) start = parsed
    }
  } else if (rule.createdAt) {
    const parsed = rule.createdAt instanceof Date ? rule.createdAt : new Date(rule.createdAt)
    if (!Number.isNaN(parsed.getTime())) start = parsed
  }
  let durationMinutes = 60
  if (durationMatch) {
    const hours = durationMatch[1] ? Number(durationMatch[1]) : 0
    const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0
    durationMinutes = Math.max(1, hours * 60 + minutes)
  }
  const end = new Date(start.getTime() + durationMinutes * 60000)
  const freq = freqMatch?.[1]
  const repeat: AvailabilityRepeat =
    freq === 'WEEKLY'
      ? 'weekly'
      : freq === 'DAILY' && countMatch?.[1] === '1'
        ? 'once'
        : freq === 'DAILY'
          ? 'daily'
          : 'once'
  return { startAt: start, endAt: end, repeat }
}
