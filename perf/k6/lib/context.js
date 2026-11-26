const current = { group: 'read', journey: 'none' }

export function setJourneyContext(group, journey) {
  current.group = group
  current.journey = journey
}

export function journeyContext() {
  return current
}
