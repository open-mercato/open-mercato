import type { CalendarItem } from '../../components/calendar/types'

function sharesActor(first: CalendarItem, second: CalendarItem): boolean {
  if (first.ownerUserId && second.ownerUserId && first.ownerUserId === second.ownerUserId) return true
  if (first.participants.length === 0 || second.participants.length === 0) return false
  const firstParticipantIds = new Set(first.participants.map((participant) => participant.userId))
  return second.participants.some((participant) => firstParticipantIds.has(participant.userId))
}

function appendConflict(conflicts: Map<string, string[]>, itemId: string, otherId: string): void {
  const existing = conflicts.get(itemId)
  if (existing) existing.push(otherId)
  else conflicts.set(itemId, [otherId])
}

export function findConflicts(items: CalendarItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>()
  const candidates = items
    .filter((item) => item.status !== 'canceled')
    .sort((first, second) => first.start.getTime() - second.start.getTime())

  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index]
    const currentEnd = current.end.getTime()
    for (let lookahead = index + 1; lookahead < candidates.length; lookahead += 1) {
      const other = candidates[lookahead]
      if (other.start.getTime() >= currentEnd) break
      if (current.start.getTime() >= other.end.getTime()) continue
      if (!sharesActor(current, other)) continue
      appendConflict(conflicts, current.id, other.id)
      appendConflict(conflicts, other.id, current.id)
    }
  }
  return conflicts
}
