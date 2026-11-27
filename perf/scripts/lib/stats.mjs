export function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight
}

export function summarize(values) {
  const sorted = Float64Array.from(values).sort()
  if (!sorted.length) return { count: 0, min: null, avg: null, p50: null, p95: null, p99: null, max: null }
  let total = 0
  for (const value of sorted) total += value
  return {
    count: sorted.length,
    min: sorted[0],
    avg: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  }
}

export function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

export function relativeDelta(current, previous) {
  if (current === null || previous === null || previous === undefined || current === undefined || previous === 0) return null
  return (current - previous) / previous
}

export function round(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
