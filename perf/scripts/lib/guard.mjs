export const COMPARABILITY_KEYS = ['scenario', 'tier', 'profile', 'hardwareProfile', 'generatorLocation', 'modules']

export const DATASET_AGE_LIMIT_DAYS = 7

const TIME_RELATIVE_TAG_PATTERNS = [
  /summary/i,
  /stuck/i,
  /needs-?attention/i,
  /dashboard/i,
  /calendar/i,
  /planned/i,
  /next-interactions/i,
  /customer-todos/i,
  /new-customers/i,
  /new-deals/i,
]

function normalizeValue(key, value) {
  if (key === 'modules') return Array.isArray(value) ? [...value].sort().join(',') : ''
  return value ?? null
}

function headHash(migrationHead) {
  if (!migrationHead) return null
  if (typeof migrationHead === 'string') return migrationHead
  return migrationHead.hash ?? null
}

export function isTimeRelativeTag(name) {
  return TIME_RELATIVE_TAG_PATTERNS.some((pattern) => pattern.test(String(name)))
}

export function checkComparability(runA, runB) {
  const mismatches = []
  for (const key of COMPARABILITY_KEYS) {
    const left = normalizeValue(key, runA[key])
    const right = normalizeValue(key, runB[key])
    if (left !== right) mismatches.push({ key, a: left, b: right })
  }
  const flags = []
  const headA = headHash(runA.migrationHead)
  const headB = headHash(runB.migrationHead)
  if (headA !== headB) flags.push({ kind: 'migration-head', message: `migration head differs (${headA ?? 'n/a'} vs ${headB ?? 'n/a'})` })
  for (const [label, run] of [['a', runA], ['b', runB]]) {
    if (typeof run.datasetAgeDays === 'number' && run.datasetAgeDays > DATASET_AGE_LIMIT_DAYS) {
      flags.push({ kind: 'dataset-age', message: `run ${label} dataset is ${run.datasetAgeDays} days old (limit ${DATASET_AGE_LIMIT_DAYS})` })
    }
  }
  const ageDelta = Math.abs((runA.datasetAgeDays ?? 0) - (runB.datasetAgeDays ?? 0))
  const timeRelativeComparable = ageDelta <= DATASET_AGE_LIMIT_DAYS
  if (!timeRelativeComparable) {
    flags.push({ kind: 'time-relative', message: `dataset ages differ by ${ageDelta} days; time-relative tags are not comparable` })
  }
  if (runA.localValidation || runB.localValidation) {
    flags.push({ kind: 'local-validation', message: 'at least one run is a local-validation run; numbers are not baseline numbers' })
  }
  return { comparable: mismatches.length === 0, mismatches, flags, timeRelativeComparable }
}

export function compareTagRows(tagsA, tagsB, { timeRelativeComparable = true } = {}) {
  const byName = new Map(tagsB.map((row) => [row.name, row]))
  const names = new Set([...tagsA.map((row) => row.name), ...tagsB.map((row) => row.name)])
  return [...names].sort().map((name) => {
    const left = tagsA.find((row) => row.name === name) ?? null
    const right = byName.get(name) ?? null
    const deltaP95 = left && right && left.p95 && right.p95 !== null ? (right.p95 - left.p95) / left.p95 : null
    const deltaP50 = left && right && left.p50 && right.p50 !== null ? (right.p50 - left.p50) / left.p50 : null
    const notComparable = !timeRelativeComparable && isTimeRelativeTag(name)
    return {
      name,
      aP50: left?.p50 ?? null,
      bP50: right?.p50 ?? null,
      deltaP50,
      aP95: left?.p95 ?? null,
      bP95: right?.p95 ?? null,
      deltaP95,
      aCount: left?.count ?? 0,
      bCount: right?.count ?? 0,
      note: notComparable ? 'not comparable (time-relative)' : !left ? 'only in b' : !right ? 'only in a' : '',
    }
  })
}
