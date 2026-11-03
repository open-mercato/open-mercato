import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingContentBlock } from '../data/entities.js'
import type { SubjectScope } from './subject-document.js'

/**
 * Reusable HTML fragments, referenced from a message as `{{block:key}}`.
 *
 * A separate syntax from `{{customer.email}}` on purpose, and the reason is escaping. An interpolated value
 * is escaped because it can come from customer data; a block is HTML written by an author who already holds
 * `campaigns.manage` and is inserted raw. Giving the two the same syntax would mean either escaping blocks
 * into visible tag soup or un-escaping customer data into an injection — so the shapes differ where the
 * trust differs.
 */

/** Slug-shaped, so a key can never smuggle syntax into the reference it appears in. */
export const BLOCK_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isValidBlockKey(key: string): boolean {
  return BLOCK_KEY_PATTERN.test(key)
}

const BLOCK_REFERENCE = /\{\{\s*block:([a-z0-9][a-z0-9_-]{0,63})\s*\}\}/gi

/** Which blocks a body refers to, so only those are loaded. */
export function referencedBlockKeys(html: string): string[] {
  const keys = new Set<string>()
  for (const match of html.matchAll(BLOCK_REFERENCE)) {
    keys.add(match[1].toLowerCase())
  }
  return [...keys]
}

/**
 * Substitutes the blocks a body refers to.
 *
 * A reference to a block that does not exist is REMOVED rather than left visible. An author who deletes a
 * block should not discover it by finding `{{block:footer}}` printed in a customer's inbox — and leaving the
 * literal text there is the one outcome worse than an empty space.
 *
 * Substitution is not recursive: a block containing another block reference leaves it unresolved. One level
 * is enough for footers and headers, and recursion here buys a cycle to guard against for no use anybody
 * asked for.
 */
export function applyContentBlocks(html: string, blocks: Record<string, string>): string {
  return html.replace(BLOCK_REFERENCE, (_match, key: string) => blocks[key.toLowerCase()] ?? '')
}

export async function loadContentBlocks(
  em: EntityManager,
  scope: SubjectScope,
  keys: string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  const rows = await em.find(MarketingContentBlock, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    key: { $in: keys },
  })
  const blocks: Record<string, string> = {}
  for (const row of rows) blocks[row.key.toLowerCase()] = row.html
  return blocks
}

/** Every block an author may reference, for the editor's own hint list. */
export async function listContentBlockKeys(
  em: EntityManager,
  scope: SubjectScope,
): Promise<Array<{ key: string; name: string }>> {
  const rows = await em.find(
    MarketingContentBlock,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { key: 'ASC' } },
  )
  return rows.map((row) => ({ key: row.key, name: row.name }))
}
