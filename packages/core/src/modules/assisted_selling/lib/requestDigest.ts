import { createHash } from 'node:crypto'

// Step 4.4 (§6.3, S23). Mirrors `cart/lib/idempotency.ts#computeRequestDigest`/`canonicalize`
// at this module's own small scope — that file is module-private to `cart` (same reasoning
// `lib/cartAccess.ts` documents for `cartService`), and `cart`'s own `canonicalize` isn't
// exported from there either, so it is duplicated rather than imported.
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeAssistedSellingRequestDigest(body: unknown): string {
  return createHash('sha256').update(canonicalize(body)).digest('hex')
}
