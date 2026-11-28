import { promises as fs, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const PROVIDER_ID = 'acme/fixture-fs'
export const DEFAULT_MAX_BATCH = 256
const MAX_BATCH_LIMIT = 10000
const ENTRY_FORMAT_VERSION = 1
const ENTRY_PREFIX = 'e-'
const HASHED_PREFIX = 'h-'
const ENTRY_SUFFIX = '.json'
const MAX_ENCODED_NAME_LENGTH = 200
const KNOWN_SETTINGS = new Set(['directory', 'maxBatch'])

function fail(issues) {
  return { success: false, error: { issues } }
}

export const settings = {
  safeParse(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail([{ path: [], message: 'Expected an object', code: 'invalid_type' }])
    }
    const issues = []
    for (const key of Object.keys(input)) {
      if (!KNOWN_SETTINGS.has(key)) issues.push({ path: [key], message: 'Unrecognized setting', code: 'unrecognized_keys' })
    }
    const { directory, maxBatch } = input
    if (typeof directory !== 'string' || directory.trim().length === 0) {
      issues.push({ path: ['directory'], message: 'Expected a non-empty directory path', code: 'invalid_type' })
    } else if (!path.isAbsolute(directory)) {
      issues.push({ path: ['directory'], message: 'Expected an absolute directory path', code: 'invalid_string' })
    }
    if (maxBatch !== undefined && (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_BATCH_LIMIT)) {
      issues.push({ path: ['maxBatch'], message: `Expected an integer between 1 and ${MAX_BATCH_LIMIT}`, code: 'invalid_number' })
    }
    if (issues.length > 0) return fail(issues)
    return { success: true, data: { directory: path.resolve(directory), maxBatch: maxBatch ?? DEFAULT_MAX_BATCH } }
  },
}

function namespaceDirectoryName(namespace) {
  return `ns-${String(namespace).replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

function entryFileName(key) {
  const encoded = Buffer.from(key, 'utf8').toString('base64url')
  if (encoded.length <= MAX_ENCODED_NAME_LENGTH) return `${ENTRY_PREFIX}${encoded}${ENTRY_SUFFIX}`
  return `${HASHED_PREFIX}${createHash('sha256').update(key).digest('hex')}${ENTRY_SUFFIX}`
}

function isEntryFileName(name) {
  return (name.startsWith(ENTRY_PREFIX) || name.startsWith(HASHED_PREFIX)) && name.endsWith(ENTRY_SUFFIX)
}

/** Absolute path of the file that stores `physicalKey` for `namespace`. Exposed for corruption tests. */
export function fixtureEntryPath(directory, namespace, physicalKey) {
  return path.join(directory, namespaceDirectoryName(namespace), entryFileName(physicalKey))
}

function isMissing(error) {
  return Boolean(error) && typeof error === 'object' && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function isEntryRecord(value) {
  return typeof value === 'object'
    && value !== null
    && value.v === ENTRY_FORMAT_VERSION
    && typeof value.key === 'string'
    && Array.isArray(value.tags)
    && (value.expiresAt === null || typeof value.expiresAt === 'number')
    && (value.encoding === 'text' || value.encoding === 'base64')
    && typeof value.payload === 'string'
}

function isExpired(entry, now = Date.now()) {
  return entry.expiresAt !== null && entry.expiresAt <= now
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function createFixtureStrategy(config, context) {
  const root = config.directory
  const directory = path.join(root, namespaceDirectoryName(context.namespace))
  const maxBatch = config.maxBatch
  const { helpers, logger } = context

  const filePath = (key) => path.join(directory, entryFileName(key))

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true })
  }

  async function readRecord(file) {
    let raw
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (error) {
      if (isMissing(error)) return { state: 'missing' }
      throw error
    }
    try {
      const parsed = JSON.parse(raw)
      if (!isEntryRecord(parsed)) return { state: 'corrupt' }
      return { state: 'ok', entry: parsed }
    } catch {
      return { state: 'corrupt' }
    }
  }

  function decodeValue(entry) {
    const raw = entry.encoding === 'base64' ? Buffer.from(entry.payload, 'base64') : entry.payload
    return JSON.parse(helpers.decode(raw))
  }

  async function discardCorrupt(file) {
    logger.warn('dropping undecodable cache entry')
    await fs.unlink(file).catch(() => undefined)
  }

  async function readValue(key, returnExpired) {
    const file = filePath(key)
    const record = await readRecord(file)
    if (record.state === 'missing') return { found: false }
    if (record.state === 'corrupt' || record.entry.key !== key) {
      await discardCorrupt(file)
      return { found: false }
    }
    if (isExpired(record.entry) && !returnExpired) return { found: false }
    try {
      return { found: true, value: decodeValue(record.entry) }
    } catch {
      await discardCorrupt(file)
      return { found: false }
    }
  }

  async function writeAtomically(file, contents) {
    const temp = path.join(directory, `.tmp-${randomUUID()}`)
    try {
      await fs.writeFile(temp, contents, 'utf8')
    } catch (error) {
      if (!isMissing(error)) throw error
      await ensureDirectory()
      await fs.writeFile(temp, contents, 'utf8')
    }
    try {
      await fs.rename(temp, file)
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined)
      throw error
    }
  }

  async function listEntryFiles() {
    let names
    try {
      names = await fs.readdir(directory)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return names.filter(isEntryFileName).map((name) => path.join(directory, name))
  }

  async function scanEntries(visit) {
    const files = await listEntryFiles()
    for (const batch of chunk(files, maxBatch)) {
      await Promise.all(batch.map(async (file) => {
        const record = await readRecord(file)
        if (record.state === 'missing') return
        await visit(file, record.state === 'ok' ? record.entry : null)
      }))
    }
  }

  // Compare-and-delete: claim the file by renaming it, re-check the claimed
  // record, and put it back (without clobbering a newer write) when it no
  // longer matches. Returns true only for a confirmed removal.
  async function removeIfStillMatching(file, predicate) {
    const claimed = path.join(directory, `.del-${randomUUID()}`)
    try {
      await fs.rename(file, claimed)
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
    const record = await readRecord(claimed)
    const matches = record.state !== 'ok' || predicate(record.entry)
    if (!matches) {
      try {
        await fs.link(claimed, file)
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          await fs.unlink(claimed).catch(() => undefined)
          throw error
        }
      }
    }
    await fs.unlink(claimed).catch(() => undefined)
    return matches && record.state === 'ok'
  }

  async function removeMatching(predicate) {
    let removed = 0
    await scanEntries(async (file, entry) => {
      if (entry && !predicate(entry)) return
      if (await removeIfStillMatching(file, predicate)) removed += 1
    })
    return removed
  }

  return {
    async get(key, options) {
      const result = await readValue(key, options?.returnExpired === true)
      return result.found ? result.value : null
    },
    async set(key, value, options) {
      const ttl = options?.ttl ?? context.defaultTtl
      const json = JSON.stringify(value === undefined ? null : value)
      const encoded = helpers.encode(json)
      const now = Date.now()
      const entry = {
        v: ENTRY_FORMAT_VERSION,
        key,
        tags: Array.from(new Set(Array.isArray(options?.tags) ? options.tags : [])),
        expiresAt: typeof ttl === 'number' && ttl > 0 ? now + ttl : null,
        createdAt: now,
        encoding: typeof encoded === 'string' ? 'text' : 'base64',
        payload: typeof encoded === 'string' ? encoded : Buffer.from(encoded).toString('base64'),
      }
      await writeAtomically(filePath(key), JSON.stringify(entry))
    },
    async has(key) {
      return (await readValue(key, false)).found
    },
    async delete(key) {
      try {
        await fs.unlink(filePath(key))
        return true
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },
    async deleteByTags(tags) {
      const wanted = new Set(Array.isArray(tags) ? tags : [])
      if (wanted.size === 0) return 0
      return removeMatching((entry) => entry.tags.some((tag) => wanted.has(tag)))
    },
    async clear() {
      return removeMatching(() => true)
    },
    async keys(pattern) {
      const found = []
      await scanEntries(async (_file, entry) => {
        if (!entry) return
        if (pattern && !helpers.matchPattern(entry.key, pattern)) return
        found.push(entry.key)
      })
      return found
    },
    async stats() {
      let size = 0
      let expired = 0
      const now = Date.now()
      await scanEntries(async (_file, entry) => {
        if (!entry) return
        size += 1
        if (isExpired(entry, now)) expired += 1
      })
      return { size, expired }
    },
    async cleanup() {
      const now = Date.now()
      return removeMatching((entry) => isExpired(entry, now))
    },
    async healthcheck() {
      await ensureDirectory()
      await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK)
    },
    async close() {},
  }
}

export const provider = {
  apiVersion: 1,
  id: PROVIDER_ID,
  settings,
  capability() {
    return { placement: 'shared' }
  },
  async create(config, context) {
    const strategy = createFixtureStrategy(config, context)
    await fs.mkdir(path.join(config.directory, namespaceDirectoryName(context.namespace)), { recursive: true })
    return strategy
  },
  redact(config) {
    return { directory: config.directory, maxBatch: config.maxBatch }
  },
}

export default provider
