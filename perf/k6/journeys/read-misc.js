import { check } from 'k6'
import { dashboard, searchGlobal, searchList } from '../lib/bundles.js'
import { sampleSearchTerm } from '../lib/catalog.js'
import { vuRng } from '../lib/random.js'
import { pickOne } from '../lib/pure/prng.js'

const LIST_TERM_KINDS = ['unique', 'common', 'prefix', 'noHit']
const GLOBAL_TERM_KINDS = ['unique', 'common', 'prefix']

export function dashboardJourney() {
  dashboard()
}

function recordHitCheck(result, kind, expected) {
  if (typeof expected !== 'number' || !result.ok) return
  const body = result.json()
  const total = body && typeof body.total === 'number' ? body.total : body && Array.isArray(body.items) ? body.items.length : null
  check(null, {
    'search.list hits as expected': () => total !== null && (expected === 0 ? total === 0 : total > 0),
  }, { strict: '0', name: `search.list:${kind}`, group: 'read', journey: 'search.list' })
}

function searchOneKind(kind) {
  const entry = sampleSearchTerm(kind)
  if (!entry || !entry.term) return
  const result = searchList(kind, entry.term)
  recordHitCheck(result, kind, entry.expected)
}

export function searchListJourney(options = {}) {
  if (options.allKinds) {
    LIST_TERM_KINDS.forEach(searchOneKind)
    return
  }
  searchOneKind(options.kind || pickOne(vuRng(), LIST_TERM_KINDS))
}

export const searchListKinds = LIST_TERM_KINDS

export function searchGlobalJourney() {
  const entry = sampleSearchTerm(pickOne(vuRng(), GLOBAL_TERM_KINDS))
  if (!entry || !entry.term) return
  searchGlobal(entry.term)
}
