export type ScheduleFrequency = 'daily' | 'weekdays' | 'weekly' | 'custom'
export type ScheduleChoice = { frequency: ScheduleFrequency; time: string; weekday: string }

export function readScheduleChoice(cron: string): ScheduleChoice {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron)
  if (!match || Number(match[1]) > 59 || Number(match[2]) > 23)
    return { frequency: 'custom', time: '07:00', weekday: '1' }
  return {
    frequency: match[3] === '*' ? 'daily' : match[3] === '1-5' ? 'weekdays' : 'weekly',
    time: `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}`,
    weekday: /^[0-6]$/.test(match[3]) ? match[3] : '1',
  }
}

export function scheduleChoiceCron(choice: ScheduleChoice): string | null {
  if (choice.frequency === 'custom' || !/^\d{2}:\d{2}$/.test(choice.time)) return null
  const [hour, minute] = choice.time.split(':').map(Number)
  if (hour > 23 || minute > 59 || !/^[0-6]$/.test(choice.weekday)) return null
  const day = choice.frequency === 'daily' ? '*' : choice.frequency === 'weekdays' ? '1-5' : choice.weekday
  return `${minute} ${hour} * * ${day}`
}
