import type { EntityManager } from '@mikro-orm/postgresql'
import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../ledger/data/entities'

type Scope = { organizationId: string; tenantId: string }

/**
 * The account type and account group `accountId` resolves to —
 * `LedgerAccount.accountTypeId` → `LedgerAccountType.accountGroupId` →
 * `LedgerAccountGroup{jurisdiction: 'PL', code: '4'}` (see Design
 * Decisions, "Detecting 'zespół 4'"). Direct cross-module entity reads,
 * bypassing the command layer, per the spec's Cross-module integration
 * (the same hard-dependency precedent `journal_entry_line_dimensions`
 * documents for `fixed_assets`).
 */
export async function loadAccountTypeAndGroup(
  em: EntityManager,
  accountId: string,
  scope: Scope,
): Promise<{ accountType: LedgerAccountType | null; group: LedgerAccountGroup | null }> {
  const account = await em.findOne(LedgerAccount, {
    id: accountId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!account) return { accountType: null, group: null }

  const accountType = await em.findOne(LedgerAccountType, {
    id: account.accountTypeId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (!accountType || !accountType.accountGroupId) return { accountType: accountType ?? null, group: null }

  const group = await em.findOne(LedgerAccountGroup, {
    id: accountType.accountGroupId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return { accountType, group: group ?? null }
}

/** Whether `accountId` belongs to the Polish chart's account group (zespół)
 * `groupCode`, i.e. resolves to `LedgerAccountGroup{jurisdiction: 'PL',
 * code: groupCode}` — the check the engine uses to detect zespół 4. */
export async function isAccountInPolishGroup(
  em: EntityManager,
  accountId: string,
  scope: Scope,
  groupCode: string,
): Promise<boolean> {
  const { group } = await loadAccountTypeAndGroup(em, accountId, scope)
  return Boolean(group && group.jurisdiction === 'PL' && group.code === groupCode)
}
