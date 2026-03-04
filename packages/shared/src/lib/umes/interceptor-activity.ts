import type { InterceptorActivityEntry } from './devtools-types'

const MAX_ACTIVITY_ENTRIES = 200
const isDev = process.env.NODE_ENV === 'development'

let activityEntries: InterceptorActivityEntry[] = []

export function getInterceptorActivityEntries(): InterceptorActivityEntry[] {
  return activityEntries
}

export function clearInterceptorActivityEntries(): void {
  activityEntries = []
}

export function logInterceptorActivity(entry: InterceptorActivityEntry): void {
  if (!isDev) return

  activityEntries.push(entry)
  if (activityEntries.length > MAX_ACTIVITY_ENTRIES) {
    activityEntries = activityEntries.slice(-MAX_ACTIVITY_ENTRIES)
  }
}
