function toEntries(weights) {
  if (Array.isArray(weights)) {
    return weights
      .map((entry) => (typeof entry === 'string'
        ? { name: entry, weight: 1 }
        : { name: entry.name ?? entry.journey ?? entry.id, weight: Number(entry.weight ?? entry.share ?? 1) }))
      .filter((entry) => typeof entry.name === 'string')
  }
  if (weights && typeof weights === 'object') {
    return Object.keys(weights).map((name) => {
      const value = weights[name]
      const weight = typeof value === 'object' && value !== null ? Number(value.weight ?? value.share ?? 0) : Number(value)
      return { name, weight }
    })
  }
  return []
}

export function normalizeWeights(weights) {
  const entries = toEntries(weights).filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) return []
  return entries.map((entry) => ({ name: entry.name, weight: entry.weight / total }))
}

export function pickWeighted(rng, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return undefined
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let cursor = rng() * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor < 0) return entry
  }
  return entries[entries.length - 1]
}

export function buildJourneyMix(groups, options = {}) {
  const excluded = new Set(options.excludeGroups ?? [])
  const known = options.knownJourneys ? new Set(options.knownJourneys) : null
  const groupNames = Object.keys(groups ?? {}).filter((name) => !excluded.has(name))
  const groupShares = normalizeWeights(groupNames.map((name) => ({ name, weight: Number(groups[name].share ?? groups[name].weight ?? 0) })))
  const mix = []
  for (const group of groupShares) {
    const journeys = normalizeWeights(groups[group.name].journeys)
      .filter((journey) => !known || known.has(journey.name))
    const journeyTotal = journeys.reduce((sum, journey) => sum + journey.weight, 0)
    if (journeyTotal <= 0) continue
    for (const journey of journeys) {
      mix.push({ group: group.name, journey: journey.name, weight: (group.weight * journey.weight) / journeyTotal })
    }
  }
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0)
  return total > 0 ? mix.map((entry) => ({ ...entry, weight: entry.weight / total })) : []
}

export function pickJourney(rng, mix) {
  return pickWeighted(rng, mix)
}

export function listJourneys(groups, options = {}) {
  const excluded = new Set(options.excludeGroups ?? [])
  const result = []
  for (const group of Object.keys(groups ?? {})) {
    if (excluded.has(group)) continue
    for (const entry of toEntries(groups[group].journeys)) {
      result.push({ group, journey: entry.name })
    }
  }
  return result
}
