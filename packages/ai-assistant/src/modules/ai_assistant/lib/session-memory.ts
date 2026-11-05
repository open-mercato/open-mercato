/**
 * Session Memory
 *
 * Process-level in-memory cache keyed by session token (`sess_xxx`).
 * Deduplicates schema/spec search queries within a single conversation,
 * reducing redundant tool calls by the AI agent.
 *
 * - Search cache: exact code string match → return cached result (max 50 entries)
 * - Memory context summary appended to every response to remind the agent
 * - Sessions auto-expire after 5 minutes (short-lived cache for active conversations)
 *
 * NOTE: Only schema/spec lookups are cached. API responses are NEVER cached
 * because data can change from external sources between calls.
 */

import { createHash } from 'node:crypto'

const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
const MAX_SEARCH_ENTRIES = 50
const MAX_MEMORY_CONTEXT_LENGTH = 500

interface CacheEntry {
  result: unknown
  timestamp: number
  label: string
}

const TOOL_CALL_HARD_CAP = 10
const TOOL_CALL_WINDOW_MS = 60 * 1000 // 60 seconds — resets for new user message

interface SessionMemory {
  searchCache: Map<string, CacheEntry>
  createdAt: number
  lastAccessedAt: number
  toolCallCount: number
  toolCallWindowStart: number
}

const sessions = new Map<string, SessionMemory>()

function getOrCreateSession(token: string): SessionMemory {
  let session = sessions.get(token)
  if (!session) {
    session = {
      searchCache: new Map(),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      toolCallCount: 0,
      toolCallWindowStart: Date.now(),
    }
    sessions.set(token, session)
  }
  session.lastAccessedAt = Date.now()
  return session
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16)
}

function evictOldest(map: Map<string, CacheEntry>, maxSize: number): void {
  if (map.size <= maxSize) return

  let oldestKey: string | null = null
  let oldestTime = Infinity

  for (const [key, entry] of map) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp
      oldestKey = key
    }
  }

  if (oldestKey) {
    map.delete(oldestKey)
  }
}

/**
 * Look up a cached search result by exact code string match.
 */
export function lookupSearchCache(token: string, code: string): CacheEntry | null {
  const session = sessions.get(token)
  if (!session) return null
  session.lastAccessedAt = Date.now()

  const key = hashCode(code)
  return session.searchCache.get(key) ?? null
}

/**
 * Store a search result in the session cache.
 */
export function storeSearchResult(token: string, code: string, result: unknown, label: string): void {
  const session = getOrCreateSession(token)
  const key = hashCode(code)

  evictOldest(session.searchCache, MAX_SEARCH_ENTRIES)
  session.searchCache.set(key, { result, timestamp: Date.now(), label })
}

/**
 * Increment the tool call counter for a session.
 * Resets the counter if more than TOOL_CALL_WINDOW_MS has elapsed (new user message).
 * Returns the current count and whether the hard cap has been exceeded.
 */
export function incrementToolCallCount(token: string): { count: number; exceeded: boolean } {
  const session = getOrCreateSession(token)
  const now = Date.now()

  // Reset counter if the window has expired (likely a new user message)
  if (now - session.toolCallWindowStart > TOOL_CALL_WINDOW_MS) {
    session.toolCallCount = 0
    session.toolCallWindowStart = now
  }

  session.toolCallCount++

  return {
    count: session.toolCallCount,
    exceeded: session.toolCallCount > TOOL_CALL_HARD_CAP,
  }
}

/**
 * Build a summary string of what this session has already discovered.
 * Appended to tool responses so the agent knows what's cached.
 */
export function buildMemoryContext(token: string): string {
  const session = sessions.get(token)
  if (!session) return ''

  const searchCount = session.searchCache.size
  if (searchCount === 0) return ''

  const labels = Array.from(session.searchCache.values())
    .slice(-3)
    .map((e) => e.label)
    .join(', ')

  const context = `[Memory: ${searchCount} schema searches cached (${labels}). Reuse previous schema results instead of re-calling.]`
  if (context.length > MAX_MEMORY_CONTEXT_LENGTH) {
    return context.slice(0, MAX_MEMORY_CONTEXT_LENGTH - 3) + '...]'
  }
  return context
}

/**
 * Build a short label from search code for the memory context summary.
 */
export function buildSearchLabel(code: string): string {
  // Try to extract the helper call: spec.findEndpoints('companies')
  const helperMatch = code.match(/spec\.(findEndpoints|describeEndpoint|describeEntity)\s*\(([^)]*)\)/)
  if (helperMatch) {
    return `${helperMatch[1]}(${helperMatch[2].slice(0, 30)})`
  }

  // Fallback: first meaningful portion
  const cleaned = code.replace(/async\s*\(\)\s*=>\s*/, '').trim()
  return cleaned.slice(0, 40)
}

// Periodic cleanup of expired sessions
const cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(token)
    }
  }
}, CLEANUP_INTERVAL_MS)

cleanupTimer.unref()
