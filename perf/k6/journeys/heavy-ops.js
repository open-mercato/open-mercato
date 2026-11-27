import { sleep } from 'k6'
import { batch, get, request } from '../lib/http.js'
import { calendarWindow, dealsMap } from '../lib/bundles.js'
import { dealSample, sampleOwner } from '../lib/catalog.js'
import { bulkJobDuration } from '../lib/metrics.js'
import { workload } from '../lib/config.js'
import { vuRng } from '../lib/random.js'
import { pickOne } from '../lib/pure/prng.js'
import { monthWindow } from '../lib/pure/misc.js'
import { parseDuration } from '../lib/pure/stages.js'

const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled']

const ENCRYPTED_SORTS = [
  { name: 'heavy.encrypted.sort:people.name', path: '/api/customers/people', query: { sortField: 'name', sortDir: 'asc' } },
  { name: 'heavy.encrypted.sort:people.primaryEmail', path: '/api/customers/people', query: { sortField: 'primaryEmail', sortDir: 'asc' } },
  { name: 'heavy.encrypted.sort:companies.name', path: '/api/customers/companies', query: { sortField: 'name', sortDir: 'asc' } },
  { name: 'heavy.encrypted.sort:deals.title', path: '/api/customers/deals', query: { sortField: 'title', sortDir: 'asc' } },
]

export function dealsSummaryJourney() {
  batch([
    get('/api/customers/deals/summary', { range: '6m' }, 'heavy.deals.summary:summary', 'object'),
    get('/api/customers/deals', { page: 1, pageSize: 20, needsAttention: 'true' }, 'heavy.deals.summary:needsAttention', 'items'),
    get('/api/customers/deals', { page: 1, pageSize: 20, isStuck: 'true' }, 'heavy.deals.summary:stuck', 'items'),
  ])
}

function runEncryptedSort(variant) {
  request(get(variant.path, { page: 1, pageSize: 20, ...variant.query }, variant.name, 'items'))
}

export function encryptedSortJourney(options = {}) {
  if (options.allVariants) {
    ENCRYPTED_SORTS.forEach(runEncryptedSort)
    return
  }
  const variant = typeof options.variant === 'number'
    ? ENCRYPTED_SORTS[options.variant % ENCRYPTED_SORTS.length]
    : pickOne(vuRng(), ENCRYPTED_SORTS)
  runEncryptedSort(variant)
}

export function calendarMonthJourney() {
  calendarWindow(monthWindow(), 'heavy.calendar.month:page')
}

export function dealsMapJourney() {
  dealsMap()
}

function startBulkOwnerJob(size) {
  const ids = dealSample(size)
  const ownerUserId = sampleOwner()
  if (ids.length === 0 || !ownerUserId) return null
  const result = request({
    method: 'POST',
    path: '/api/customers/deals/bulk-update-owner',
    body: { ids, ownerUserId },
    name: `heavy.bulk.owner:post.${size}`,
    expect: (body) => body.ok === true,
  })
  const body = result.ok ? result.json() : null
  return body && body.progressJobId ? { jobId: body.progressJobId, startedAt: Date.now(), size: ids.length } : null
}

function serverDurationMs(job) {
  const finished = Date.parse(job.finishedAt || '')
  const created = Date.parse(job.createdAt || job.startedAt || '')
  return Number.isFinite(finished) && Number.isFinite(created) ? finished - created : null
}

export function pollProgressJob(started, { intervalSeconds, timeoutSeconds }) {
  const deadline = started.startedAt + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    sleep(intervalSeconds)
    const result = request(get(`/api/progress/jobs/${started.jobId}`, null, 'heavy.bulk.owner:poll', 'status'))
    const job = result.ok ? result.json() : null
    if (job && TERMINAL_JOB_STATUSES.includes(job.status)) {
      const duration = serverDurationMs(job) ?? Date.now() - started.startedAt
      bulkJobDuration.add(duration, { size: String(started.size), status: job.status })
      return job
    }
  }
  bulkJobDuration.add(Date.now() - started.startedAt, { size: String(started.size), status: 'timeout' })
  return null
}

export function bulkOwnerJourney({ size, poll = false } = {}) {
  const jobSize = size || Number(workload.bulk.mixedSize ?? 100)
  const started = startBulkOwnerJob(jobSize)
  if (!started || !poll) return started
  return pollProgressJob(started, {
    intervalSeconds: Number(workload.interference.bulkPollIntervalSeconds ?? 5),
    timeoutSeconds: parseDuration(workload.interference.bulkTimeout ?? '30m'),
  })
}
