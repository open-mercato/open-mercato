import type { EntityManager } from '@mikro-orm/postgresql'
import { LedgerAccountGroup } from '../data/entities'

export type LedgerAccountGroupSeedScope = { tenantId: string; organizationId: string }

type AccountGroupSeed = {
  code: string
  name: string
}

/**
 * Poland's standard "zespoły" (0-8) chart-of-accounts classification —
 * the "wzorcowy plan kont" used across Polish commercial accounting
 * (verified against https://www.360ksiegowosc.pl/plan-kont-charakterystyka-rodzaje-wzorcowy-wykaz/,
 * cross-checked in substance against the Ministry of Finance's
 * budget-sector "Zakładowy plan kont" annex — zespoły 0-4/7-8 match; 5/6
 * are commercial-only, absent from the budget-sector variant since it has
 * no production/goods activity to allocate).
 */
const SEED_ACCOUNT_GROUPS_PL: AccountGroupSeed[] = [
  { code: '0', name: 'Aktywa trwałe' },
  { code: '1', name: 'Środki pieniężne, rachunki bankowe oraz inne krótkoterminowe aktywa finansowe' },
  { code: '2', name: 'Rozrachunki i roszczenia' },
  { code: '3', name: 'Materiały i towary' },
  { code: '4', name: 'Koszty według rodzajów i ich rozliczenie' },
  { code: '5', name: 'Koszty według typów działalności i ich rozliczenie' },
  { code: '6', name: 'Produkty i rozliczenia międzyokresowe' },
  { code: '7', name: 'Przychody i koszty związane z ich osiągnięciem' },
  { code: '8', name: 'Kapitały (fundusze), fundusze specjalne, rezerwy i wynik finansowy' },
]

/**
 * Seeds `LedgerAccountGroup` rows for `jurisdiction: 'PL'` into this
 * organization's scope. Phase 1 hardcodes 'PL' — no jurisdiction-
 * selection mechanism exists yet (see the spec's Design decisions).
 * `LedgerAccountGroup` rows are system reference data, never edited by a
 * tenant through any command, so this only creates missing rows — it
 * never updates an existing one (unlike `seedExampleCurrencies`, which
 * also patches drifted `name` values, because `Currency` rows there are
 * user-editable reference data and these are not).
 */
export async function seedPolishAccountGroups(
  em: EntityManager,
  scope: LedgerAccountGroupSeedScope
): Promise<boolean> {
  const existingEntries = await em.find(LedgerAccountGroup, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    jurisdiction: 'PL',
  })
  const existingCodes = new Set(existingEntries.map((entry) => entry.code))

  let touched = false
  for (const group of SEED_ACCOUNT_GROUPS_PL) {
    if (existingCodes.has(group.code)) continue
    const entry = em.create(LedgerAccountGroup, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      jurisdiction: 'PL',
      code: group.code,
      name: group.name,
      createdAt: new Date(),
    })
    em.persist(entry)
    touched = true
  }

  if (touched) {
    await em.flush()
  }
  return touched
}
