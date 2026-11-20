// Creating dataset records without duplicates.
//
// A create can commit even when the client never sees the success: the response is lost (app
// restart, connection reset) or a 5xx comes back after the transaction committed. Worse, a request
// whose connection dropped can still be running on the server and commit later. The API takes no
// client-supplied id, so the seeder never creates an index again on its own once an attempt's
// outcome is unknown:
//
// - It asks `findCommitted` whether a record with that index's identity exists. If it does, the
//   index is done.
// - If it does not, that proves nothing (the original request may still commit), so the index stays
//   pending and is reported as unresolved. The run carries on with other indexes.
// - On a later run, pending indexes are looked up again. One that is still missing is created again
//   only with `retryUnknown`, which the operator passes once the original requests have certainly
//   ended (the app was restarted, or enough time has passed for its request timeout).
//
// Only failures that prove the request never reached the app (connection refused) or that the app
// rejected it before writing (401, 429) are retried automatically.
//
// The progress log has two kinds of lines: `pending <index> <iso time>` before each attempt and
// `<index>` once the record is known to exist.

/** @returns {{ done: Set<number>, pending: Map<number, string> }} pending: index -> time of its last attempt */
export function parseProgress(text) {
  const done = new Set()
  const pending = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (/^\d+$/.test(trimmed)) {
      done.add(Number(trimmed))
      continue
    }
    const match = /^pending (\d+) (\S+)$/.exec(trimmed)
    if (match) pending.set(Number(match[1]), match[2])
  }
  for (const index of done) pending.delete(index)
  return { done, pending }
}

/** True when the request cannot have reached the server, so retrying it cannot duplicate a write. */
export function neverSent(error) {
  return error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED'
}

/**
 * Checks that every expected domain occurs exactly once among the listed records.
 *
 * @param {Map<string, number>} expected domain -> index
 * @param {Iterable<string | null | undefined>} domains domains of the records in the organization
 * @param {Set<number>} [unresolved] indexes allowed to be missing (outcome still unknown)
 */
export function verifyIndexes(expected, domains, unresolved = new Set()) {
  const counts = new Map()
  for (const domain of domains) if (expected.has(domain)) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([domain, count]) => ({ index: expected.get(domain), count }))
    .sort((a, b) => a.index - b.index)
  const missing = [...expected]
    .filter(([domain, index]) => !counts.has(domain) && !unresolved.has(index))
    .map(([, index]) => index)
    .sort((a, b) => a - b)
  return { duplicates, missing }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Creates the given indexes, never more than once each.
 *
 * @param {object} options
 * @param {string} options.target label used in errors
 * @param {number[]} options.indexes indexes not yet known to exist, in creation order
 * @param {Map<number, string>} [options.pending] indexes left with an unknown outcome by a previous run
 * @param {boolean} [options.retryUnknown] create pending indexes that are still missing again
 * @param {number} options.concurrency
 * @param {(index: number) => Promise<{ status: number, text?: () => Promise<string> }>} options.send
 *   one create; throws when no response arrived
 * @param {() => Promise<void>} options.relogin called after a 401
 * @param {(candidates: Map<number, string>) => Promise<Set<number>>} options.findCommitted
 *   which candidate indexes exist as records created at or after their given time
 * @param {{ pending: (index: number, at: string) => void, done: (index: number) => void }} options.log
 * @returns {Promise<{ created: number, recovered: number, unresolved: number[] }>}
 *   unresolved: indexes whose outcome is still unknown; they stay pending in the log
 */
export async function seedCompanies({
  target,
  indexes,
  pending = new Map(),
  retryUnknown = false,
  concurrency,
  send,
  relogin,
  findCommitted,
  log,
  maxAttempts = 6,
  now = () => new Date(),
  sleep = defaultSleep,
  onCreated = () => {},
}) {
  let recovered = 0
  let created = 0
  const unresolved = []

  // Asking can fail for the same reason the create did (the app is restarting): keep asking
  // rather than guessing, because guessing wrong is exactly what creates a duplicate.
  async function committed(candidates) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await findCommitted(candidates)
      } catch (error) {
        if (attempt >= maxAttempts) throw new Error(`${target}: cannot tell whether indexes ${[...candidates.keys()].join(', ')} were created (${error.message}); rerun to reconcile them`)
        await sleep(2000 * attempt)
      }
    }
  }

  const todo = [...indexes]
  if (pending.size) {
    const found = await committed(pending)
    for (const index of found) {
      log.done(index)
      recovered++
    }
    const missing = [...pending.keys()].filter((index) => !found.has(index)).sort((a, b) => a - b)
    if (retryUnknown) {
      // The operator vouches that the earlier requests have ended. Create these first so the
      // creation order stays close to the plan order.
      const rest = todo.filter((index) => !missing.includes(index) && !found.has(index))
      todo.length = 0
      todo.push(...missing, ...rest)
    } else {
      unresolved.push(...missing)
      const skip = new Set([...missing, ...found])
      const rest = todo.filter((index) => !skip.has(index))
      todo.length = 0
      todo.push(...rest)
    }
  }

  async function create(index) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const at = now().toISOString()
      log.pending(index, at)
      let response = null
      try {
        response = await send(index)
      } catch (error) {
        if (neverSent(error)) {
          await sleep(2000 * attempt)
          continue
        }
        response = null
      }
      if (response && response.status >= 200 && response.status < 300) return 'created'
      if (!response || response.status >= 500) {
        // No answer or a server error: the record may exist, or may still be written.
        await sleep(2000)
        return (await committed(new Map([[index, at]]))).has(index) ? 'recovered' : 'unknown'
      }
      if (response.status === 401) await relogin()
      else if (response.status !== 429) {
        const body = response.text ? await response.text() : ''
        throw new Error(`${target}#${index}: HTTP ${response.status} ${body.slice(0, 400)}`)
      }
      await sleep(500 * attempt)
    }
    throw new Error(`${target}#${index}: gave up after ${maxAttempts} attempts`)
  }

  let cursor = 0
  const workers = await Promise.allSettled(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < todo.length) {
      const index = todo[cursor++]
      const outcome = await create(index)
      if (outcome === 'unknown') {
        unresolved.push(index)
        continue
      }
      log.done(index)
      if (outcome === 'recovered') recovered++
      else created++
      onCreated(index)
    }
  }))
  const failure = workers.find((worker) => worker.status === 'rejected')
  if (failure) throw failure.reason
  return { created, recovered, unresolved: unresolved.sort((a, b) => a - b) }
}
