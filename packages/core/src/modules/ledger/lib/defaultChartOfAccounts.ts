import type { LedgerNormalBalance } from '../data/entities'

export type DefaultChartOfAccountsAccountSeed = {
  /** e.g. `010-1` — the child `LedgerAccount.number`. */
  number: string
  /** `LedgerAccount` has no `name` field — this becomes `description`. */
  description: string
}

export type DefaultChartOfAccountsAccountTypeSeed = {
  /** `LedgerAccountType.number`, e.g. `010`. */
  number: string
  name: string
  normalBalance: LedgerNormalBalance
  /**
   * Links to the already-seeded `LedgerAccountGroup.code` for this zespół
   * (`jurisdiction: 'PL'` — see `lib/seeds.ts`'s `seedPolishAccountGroups`).
   * Resolved to the real `accountGroupId` at import time, not hardcoded
   * here, since that id is generated per organization.
   */
  accountGroupCode: string
  accounts: DefaultChartOfAccountsAccountSeed[]
}

/**
 * Default Polish "wzorcowy plan kont" — Phase 1 hardcoded template data
 * for `ledger.importDefaultChartOfAccounts` (PR #6137,
 * `docs/default-chart-of-accounts`, OM-16). Representative, not
 * exhaustive: a working subset of each zespół (0-8), not a complete
 * professional plan kont — see the spec's Design Decisions and Data
 * Models. Every `number` here is illustrative, never read or matched by
 * name anywhere else in this codebase (knowledge base §2 convention).
 *
 * 39 `LedgerAccountType` rows, 43 `LedgerAccount` rows. Deliberately
 * leaves numbering gaps within each zespół (e.g. `010`/`020`/`070`, not
 * `010`/`011`/`012`), matching Kieso's own Illustration 3.9 convention —
 * room for a tenant to insert their own accounts after import without
 * renumbering anything this template created.
 *
 * Zespół 0's `070`/`071`/`072` split (tangible vs. intangible
 * accumulated depreciation, plus a separate accumulated-impairment
 * account) follows Fixed Assets' own 2026-09-09 correction against a
 * real accounting-team-supplied reference chart of accounts —
 * `FixedAsset.ledgerAccumulatedImpairmentAccountId` expects `072` to
 * exist as a real, importable account.
 */
export const DEFAULT_CHART_OF_ACCOUNTS_PL: DefaultChartOfAccountsAccountTypeSeed[] = [
  // Zespół 0 — Aktywa trwałe
  {
    number: '010',
    name: 'Środki trwałe',
    normalBalance: 'DEBIT',
    accountGroupCode: '0',
    accounts: [
      { number: '010-1', description: 'Budynki i lokale' },
      { number: '010-2', description: 'Maszyny i urządzenia techniczne' },
      { number: '010-3', description: 'Środki transportu' },
    ],
  },
  {
    number: '020',
    name: 'Wartości niematerialne i prawne',
    normalBalance: 'DEBIT',
    accountGroupCode: '0',
    accounts: [{ number: '020-1', description: 'Licencje i oprogramowanie' }],
  },
  {
    number: '070',
    name: 'Umorzenie środków trwałych',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ number: '070-1', description: 'Umorzenie środków trwałych' }],
  },
  {
    number: '071',
    name: 'Umorzenie wartości niematerialnych i prawnych',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ number: '071-1', description: 'Umorzenie wartości niematerialnych i prawnych' }],
  },
  {
    number: '072',
    name: 'Odpisy aktualizujące środki trwałe oraz wartości niematerialne i prawne',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ number: '072-1', description: 'Odpisy aktualizujące środki trwałe oraz WNiP' }],
  },

  // Zespół 1 — Środki pieniężne, rachunki bankowe i inne krótkoterminowe aktywa finansowe
  {
    number: '100',
    name: 'Kasa',
    normalBalance: 'DEBIT',
    accountGroupCode: '1',
    accounts: [{ number: '100-1', description: 'Kasa złotowa' }],
  },
  {
    number: '130',
    name: 'Rachunki bankowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '1',
    accounts: [
      { number: '130-1', description: 'Rachunek bieżący PLN' },
      { number: '130-2', description: 'Rachunek walutowy EUR' },
    ],
  },

  // Zespół 2 — Rozrachunki i roszczenia
  {
    number: '200',
    name: 'Rozrachunki z odbiorcami',
    normalBalance: 'DEBIT',
    accountGroupCode: '2',
    accounts: [{ number: '200-1', description: 'Rozrachunki z odbiorcami krajowymi' }],
  },
  {
    number: '210',
    name: 'Rozrachunki z dostawcami',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ number: '210-1', description: 'Rozrachunki z dostawcami krajowymi' }],
  },
  {
    number: '220',
    name: 'VAT naliczony',
    normalBalance: 'DEBIT',
    accountGroupCode: '2',
    accounts: [{ number: '220-1', description: 'VAT naliczony podlegający odliczeniu' }],
  },
  {
    number: '221',
    name: 'VAT należny',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ number: '221-1', description: 'VAT należny' }],
  },
  {
    number: '225',
    name: 'Rozrachunki z ZUS',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ number: '225-1', description: 'Rozrachunki z ZUS' }],
  },
  {
    number: '230',
    name: 'Rozrachunki z tytułu wynagrodzeń',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ number: '230-1', description: 'Rozrachunki z pracownikami z tytułu wynagrodzeń' }],
  },

  // Zespół 3 — Materiały i towary
  {
    number: '300',
    name: 'Rozliczenie zakupu',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ number: '300-1', description: 'Rozliczenie zakupu materiałów i towarów' }],
  },
  {
    number: '310',
    name: 'Materiały',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ number: '310-1', description: 'Materiały w magazynie' }],
  },
  {
    number: '330',
    name: 'Towary',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ number: '330-1', description: 'Towary w magazynie' }],
  },

  // Zespół 4 — Koszty według rodzajów i ich rozliczenie
  {
    number: '400',
    name: 'Amortyzacja',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '400-1', description: 'Amortyzacja środków trwałych' }],
  },
  {
    number: '401',
    name: 'Zużycie materiałów i energii',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [
      { number: '401-1', description: 'Zużycie materiałów' },
      { number: '401-2', description: 'Zużycie energii' },
    ],
  },
  {
    number: '402',
    name: 'Usługi obce',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '402-1', description: 'Usługi obce' }],
  },
  {
    number: '403',
    name: 'Podatki i opłaty',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '403-1', description: 'Podatki i opłaty' }],
  },
  {
    number: '404',
    name: 'Wynagrodzenia',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '404-1', description: 'Wynagrodzenia' }],
  },
  {
    number: '405',
    name: 'Ubezpieczenia społeczne i inne świadczenia',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '405-1', description: 'Ubezpieczenia społeczne' }],
  },
  {
    number: '409',
    name: 'Pozostałe koszty rodzajowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ number: '409-1', description: 'Pozostałe koszty rodzajowe' }],
  },
  // PR #6137 review, m3: technical clearing account for the zespół 4->5
  // cost reclassification `posting-rules-engine` (#6015) performs — that
  // spec's own Design Decisions requires this account to exist
  // ("account 490 resolves to `code: '4'` like any other zespół 4
  // account"). Modeled as `normalBalance: 'CREDIT'` (changed from 'DEBIT'
  // on 2026-10-12): the engine debits the zespół 5 account and credits 490
  // for every zespół 4 posting, and its spec's invariant 2 describes the
  // clearing account's engine-posted balance as a *credit* balance. A
  // type's `normalBalance` is immutable once an account of it has posted
  // entries, so the sign is fixed here rather than later.
  {
    number: '490',
    name: 'Rozliczenie kosztów',
    normalBalance: 'CREDIT',
    accountGroupCode: '4',
    accounts: [{ number: '490-1', description: 'Rozliczenie kosztów międzyzespołowe (4 -> 5)' }],
  },

  // Zespół 5 — Koszty według typów działalności i ich rozliczenie
  {
    number: '550',
    name: 'Koszty zarządu',
    normalBalance: 'DEBIT',
    accountGroupCode: '5',
    accounts: [{ number: '550-1', description: 'Koszty zarządu' }],
  },
  {
    number: '552',
    name: 'Koszty sprzedaży',
    normalBalance: 'DEBIT',
    accountGroupCode: '5',
    accounts: [{ number: '552-1', description: 'Koszty sprzedaży' }],
  },

  // Zespół 6 — Produkty i rozliczenia międzyokresowe
  {
    number: '600',
    name: 'Produkty gotowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '6',
    accounts: [{ number: '600-1', description: 'Wyroby gotowe' }],
  },
  {
    number: '640',
    name: 'Rozliczenia międzyokresowe kosztów czynne',
    normalBalance: 'DEBIT',
    accountGroupCode: '6',
    accounts: [{ number: '640-1', description: 'Rozliczenia międzyokresowe kosztów czynne' }],
  },

  // Zespół 7 — Przychody i koszty związane z ich osiągnięciem
  {
    number: '700',
    name: 'Przychody ze sprzedaży produktów',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ number: '700-1', description: 'Przychody ze sprzedaży produktów' }],
  },
  {
    number: '701',
    name: 'Koszt sprzedanych produktów',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ number: '701-1', description: 'Koszt sprzedanych produktów' }],
  },
  {
    number: '730',
    name: 'Przychody ze sprzedaży towarów',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ number: '730-1', description: 'Przychody ze sprzedaży towarów' }],
  },
  {
    number: '731',
    name: 'Wartość sprzedanych towarów w cenie zakupu',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ number: '731-1', description: 'Wartość sprzedanych towarów w cenie zakupu' }],
  },
  {
    number: '750',
    name: 'Przychody finansowe',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ number: '750-1', description: 'Przychody finansowe' }],
  },
  {
    number: '751',
    name: 'Koszty finansowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ number: '751-1', description: 'Koszty finansowe' }],
  },
  {
    number: '760',
    name: 'Pozostałe przychody operacyjne',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ number: '760-1', description: 'Pozostałe przychody operacyjne' }],
  },
  {
    number: '761',
    name: 'Pozostałe koszty operacyjne',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ number: '761-1', description: 'Pozostałe koszty operacyjne' }],
  },

  // Zespół 8 — Kapitały (fundusze) własne, fundusze specjalne i wynik finansowy
  {
    number: '800',
    name: 'Kapitał (fundusz) podstawowy',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ number: '800-1', description: 'Kapitał (fundusz) podstawowy' }],
  },
  {
    number: '820',
    name: 'Rozliczenie wyniku finansowego',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ number: '820-1', description: 'Rozliczenie wyniku finansowego' }],
  },
  {
    number: '840',
    name: 'Rozliczenia międzyokresowe przychodów',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    // PR forward-pointer (Deferred Revenue, PR #6193): the account
    // `RevenueDeferral` records against until the recognition schedule
    // accrues it into `700`/`730` — the credit-side counterpart to `640`.
    accounts: [{ number: '840-1', description: 'Rozliczenia międzyokresowe przychodów' }],
  },
  {
    number: '860',
    name: 'Wynik finansowy',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ number: '860-1', description: 'Wynik finansowy' }],
  },
]
