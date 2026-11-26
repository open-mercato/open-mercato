const DEFAULT_SATURATION = { p95Factor: 2, maxErrorRate: 0.01, minThroughputGrowthRatio: 0.8 }

export function detectSaturation(steps, criteria = {}) {
  const settings = { ...DEFAULT_SATURATION, ...criteria }
  const measured = steps.filter((step) => step.requests > 0)
  if (!measured.length) return null
  const reference = measured[0]
  for (let index = 0; index < measured.length; index += 1) {
    const current = measured[index]
    const reasons = []
    if (current.errorRate > settings.maxErrorRate) {
      reasons.push(`error rate ${(current.errorRate * 100).toFixed(2)}% > ${(settings.maxErrorRate * 100).toFixed(2)}%`)
    }
    if (index > 0 && reference.readP95 && current.readP95 && current.readP95 > settings.p95Factor * reference.readP95) {
      reasons.push(`read p95 ${current.readP95.toFixed(0)} ms > ${settings.p95Factor}x step ${reference.step} (${reference.readP95.toFixed(0)} ms)`)
    }
    const previous = measured[index - 1]
    if (previous && previous.vus > 0 && current.vus > previous.vus && previous.throughput && current.throughput !== null) {
      const vuGrowth = current.vus / previous.vus - 1
      const throughputGrowth = current.throughput / previous.throughput - 1
      if (throughputGrowth < settings.minThroughputGrowthRatio * vuGrowth) {
        reasons.push(`throughput grew ${(throughputGrowth * 100).toFixed(0)}% for ${(vuGrowth * 100).toFixed(0)}% more VUs`)
      }
    }
    if (reasons.length) return { step: current.step, vus: current.vus, reasons }
  }
  return null
}

export function worstEndpoints(overallTags, limit = 3) {
  return [...overallTags]
    .filter((row) => row.count > 0 && row.p95 !== null)
    .sort((left, right) => right.p95 - left.p95)
    .slice(0, limit)
}

export function errorBudget(overallTags) {
  let total = 0
  let failed = 0
  let conflicts = 0
  for (const row of overallTags) {
    total += row.count ?? 0
    failed += (row.errorRate ?? 0) * (row.count ?? 0)
    conflicts += (row.conflictRate ?? 0) * (row.count ?? 0)
  }
  return { requests: total, errorRate: total ? failed / total : 0, conflictRate: total ? conflicts / total : 0 }
}
