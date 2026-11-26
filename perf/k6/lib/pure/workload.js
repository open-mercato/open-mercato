export const DEFAULT_WORKLOAD = {
  version: 1,
  groups: {
    read: {
      share: 70,
      journeys: {
        'people.list': 20,
        'person.360': 20,
        'companies.list': 8,
        'company.360': 8,
        'deals.pipeline': 6,
        'deals.list': 3,
        dashboard: 3,
        'search.list': 1,
        'search.global': 1,
      },
    },
    write: {
      share: 20,
      journeys: {
        'write.interaction': 7,
        'write.person.edit': 4,
        'write.deal.stage': 3,
        'write.person.create': 2,
        'write.deal.create': 1,
        'write.task.complete': 1,
        'write.deal.comment': 1,
        'write.tag.assign': 1,
      },
    },
    heavy: {
      share: 10,
      journeys: {
        'heavy.deals.summary': 3,
        'heavy.encrypted.sort': 3,
        'heavy.calendar.month': 2,
        'heavy.deals.map': 1,
        'heavy.bulk.owner': 1,
      },
    },
  },
  thinkTime: { minSeconds: 5, maxSeconds: 30 },
  sampling: { buckets: { lightMedium: 80, heavy: 15, extreme: 5 }, hotSetWriteShare: 0.1, recentShare: 0.1 },
  warmup: { vus: 10, duration: '3m' },
  bulk: { mixedSize: 100, interferenceSize: 1000 },
  login: { ratePerMinute: 2 },
  profiles: {
    mini: { kind: 'steps', ramp: '1m', hold: '5m', steps: [10, 25] },
    step: { kind: 'steps', ramp: '2m', hold: '10m', steps: [10, 25, 50, 100, 200] },
    stress: {
      kind: 'stress',
      ramp: '1m',
      hold: '5m',
      multipliers: [1.5, 2, 3],
      fallbackVus: [300, 400, 600],
      recovery: { vus: 25, ramp: '1m', hold: '10m' },
    },
    soak: { kind: 'soak', fraction: 0.5, fallbackVus: 50, ramp: '5m', hold: '4h' },
  },
  interference: {
    vus: 50,
    kneeFraction: 0.5,
    controlWindow: '10m',
    injectionWindow: '10m',
    recoveryWindow: '10m',
    injectorRatePerMinute: 6,
    injectorJourneys: ['heavy.deals.summary', 'heavy.deals.map', 'heavy.encrypted.sort', 'heavy.calendar.month'],
    bulkOffsets: ['0m', '5m'],
    bulkPollIntervalSeconds: 5,
    bulkTimeout: '30m',
  },
  smoke: { vus: 2, duration: '5m', thinkTime: { minSeconds: 1, maxSeconds: 3 } },
  baseline: { samples: 50, warmupRounds: 2 },
  browser: { vus: 2, maxVus: 5, duration: '10m' },
  safety: { maxErrorRate: 0.2, errorWindow: '2m', maxP95Ms: 30000 },
  reference: { readP95Ms: 500, errorRate: 0.01, lcpMs: 2500, inpMs: 200, cls: 0.1 },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override
  const result = { ...base }
  for (const key of Object.keys(override)) {
    result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? deepMerge(base[key], override[key])
      : override[key]
  }
  return result
}

function normalizeGroups(raw) {
  const source = raw.groups ?? raw.mix ?? raw.journeyMix
  if (Array.isArray(source)) {
    const groups = {}
    for (const entry of source) {
      const name = entry.group ?? entry.name
      if (!name) continue
      groups[name] = { share: Number(entry.share ?? entry.weight ?? 0), journeys: entry.journeys ?? {} }
    }
    return groups
  }
  if (isPlainObject(source)) {
    const groups = {}
    for (const name of Object.keys(source)) {
      const entry = source[name]
      groups[name] = { share: Number(entry.share ?? entry.weight ?? 0), journeys: entry.journeys ?? entry.weights ?? {} }
    }
    return groups
  }
  return undefined
}

function normalizeThinkTime(value) {
  if (Array.isArray(value)) return { minSeconds: Number(value[0]), maxSeconds: Number(value[1]) }
  if (!isPlainObject(value)) return undefined
  return {
    ...value,
    minSeconds: Number(value.minSeconds ?? value.min ?? value.minS ?? 5),
    maxSeconds: Number(value.maxSeconds ?? value.max ?? value.maxS ?? 30),
  }
}

export function normalizeWorkload(raw) {
  if (!isPlainObject(raw)) return deepMerge(DEFAULT_WORKLOAD, {})
  const override = { ...raw }
  const groups = normalizeGroups(raw)
  delete override.mix
  delete override.journeyMix
  delete override.groups
  const thinkTime = normalizeThinkTime(raw.thinkTime ?? raw.think)
  delete override.think
  if (thinkTime) override.thinkTime = thinkTime
  const merged = deepMerge(DEFAULT_WORKLOAD, override)
  if (groups && Object.keys(groups).length > 0) merged.groups = groups
  return merged
}
