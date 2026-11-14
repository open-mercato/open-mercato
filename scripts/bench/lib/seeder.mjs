// Creating dataset records without duplicates.
//
// A create can commit even when the client never sees the success: the response is lost (app
// restart, connection reset) or a 5xx comes back after the transaction committed. The API takes no
// client-supplied id, so before retrying such an index the seeder asks `findCommitted` whether a
// record with that index's identity was created since the attempt started, and only creates it
// again when it was not.
//
// The progress log has two kinds of lines: `pending <index> <iso time>` before each attempt and
// `<index>` once the record is known to exist. A pending index without a done line (the script was
// interrupted between the create and the log append) is reconciled the same way on the next run.

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

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Creates every index in `indexes` exactly once.
 *
 * @param {object} options
 * @param {string} options.target label used in errors
 * @param {number[]} options.indexes indexes not yet known to exist, in creation order
 * @param {Map<number, string>} [options.pending] indexes whose last attempt has no known outcome
 * @param {number} options.concurrency
 * @param {(index: number) => Promise<{ status: number, text?: () => Promise<string> }>} options.send
 *   one create; throws when no response arrived
 * @param {() => Promise<void>} options.relogin called after a 401
 * @param {(candidates: Map<number, string>) => Promise<Set<number>>} options.findCommitted
 *   which candidate indexes exist as records created at or after their given time
 * @param {{ pending: (index: number, at: string) => void, done: (index: number) => void }} options.log
 * @returns {Promise<{ created: number, recovered: number }>}
 */
export async function seedCompanies({
  target,
  indexes,
  pending = new Map(),
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
    const unresolved = new Set([...pending.keys()].filter((index) => !found.has(index)))
    // Retry interrupted indexes first so the creation order stays close to the plan order.
    const rest = todo.filter((index) => !unresolved.has(index) && !found.has(index))
    todo.length = 0
    todo.push(...[...unresolved].sort((a, b) => a - b), ...rest)
  }

  async function create(index) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const at = now().toISOString()
      log.pending(index, at)
      let response = null
      try {
        response = await send(index)
      } catch {
        response = null
      }
      if (response && response.status >= 200 && response.status < 300) return 'created'
      if (!response || response.status >= 500) {
        // No answer or a server error: the record may exist anyway.
        await sleep(2000 * attempt)
        if ((await committed(new Map([[index, at]]))).has(index)) return 'recovered'
        continue
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
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < todo.length) {
      const index = todo[cursor++]
      const outcome = await create(index)
      log.done(index)
      if (outcome === 'recovered') recovered++
      else created++
      onCreated(index)
    }
  }))
  return { created, recovered }
}
