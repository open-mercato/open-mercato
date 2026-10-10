/**
 * Seeding a chart of accounts from a jurisdiction's template.
 *
 * The template is data (`ChartOfAccountsTemplateContract`), and every account is
 * keyed by its **code**, so running this twice creates nothing twice and a tenant
 * that renamed an account keeps its name. That idempotency is what lets the seed
 * be re-run after a template gains an account — the point of the VAT accounts
 * being declared in the template is that adding one must be able to reach a
 * tenant that already has books.
 *
 * A template may declare `parentCode`; the parent is resolved *after* its own
 * insert within the same pass, so a child can reference a parent defined later in
 * the list. A missing parent is reported rather than silently dropped — an
 * orphaned child would land at the chart's root and quietly change the statements.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ChartOfAccountsEntry, ChartOfAccountsTemplateContract } from './contracts'
import { GlAccount } from '../data/entities'

export type ChartSeedScope = { tenantId: string; organizationId: string }

export type ChartSeedResult = {
  created: string[]
  skipped: string[]
  currencyCode: string
}

export type ChartSeedOptions = {
  /** The currency the seeded accounts report in. */
  currencyCode: string
  /** Recorded on every seeded account so a reader knows where it came from. */
  countryCode?: string | null
}

export async function seedChartOfAccounts(
  em: EntityManager,
  scope: ChartSeedScope,
  template: ChartOfAccountsTemplateContract,
  options: ChartSeedOptions,
): Promise<ChartSeedResult> {
  const entries = template.listAccounts()
  const created: string[] = []
  const skipped: string[] = []

  const existing = await em.find(GlAccount, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const byCode = new Map(existing.map((account) => [account.code, account]))

  for (const entry of entries) {
    const found = byCode.get(entry.code)
    if (found) {
      skipped.push(entry.code)
      // An account that exists keeps its own parent: an operator may have
      // reorganised the chart, and re-seeding must not undo that.
      continue
    }
    const account = em.create(GlAccount, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: entry.code,
      name: entry.name,
      accountClass: entry.accountClass,
      accountType: entry.accountType ?? null,
      currencyCode: options.currencyCode,
      normalBalance: entry.normalBalance,
      countryCode: options.countryCode ?? null,
      parentId: null,
    })
    em.persist(account)
    byCode.set(entry.code, account)
    created.push(entry.code)
  }

  await em.flush()

  await assignParents(em, byCode, entries)

  return { created, skipped, currencyCode: options.currencyCode }
}

async function assignParents(
  em: EntityManager,
  byCode: Map<string, GlAccount>,
  entries: readonly ChartOfAccountsEntry[],
): Promise<void> {
  let dirty = false
  for (const entry of entries) {
    if (!entry.parentCode) continue
    const account = byCode.get(entry.code)
    const parent = byCode.get(entry.parentCode)
    if (!account || !parent) continue
    if (account.id === parent.id) continue
    if (account.parentId) continue
    account.parentId = parent.id
    dirty = true
  }
  if (dirty) await em.flush()
}

/**
 * The codes a template would add that the organization does not have yet. Used by
 * the preview so an operator sees what a seed would do before it does it.
 */
export function missingChartCodes(
  template: ChartOfAccountsTemplateContract,
  existingCodes: readonly string[],
): string[] {
  const present = new Set(existingCodes)
  return template.listAccounts().filter((entry) => !present.has(entry.code)).map((entry) => entry.code)
}
