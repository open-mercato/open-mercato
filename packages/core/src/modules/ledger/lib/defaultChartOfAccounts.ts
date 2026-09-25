import type { LedgerNormalBalance } from '../data/entities'

export type DefaultChartOfAccountsAccountSeed = {
  /** e.g. `010-1` — the child `LedgerAccount.slug`. */
  slug: string
  /** `LedgerAccount` has no `name` field — this becomes `description`. */
  description: string
}

export type DefaultChartOfAccountsAccountTypeSeed = {
  /** `LedgerAccountType.slug`, e.g. `010`. */
  slug: string
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
 * Models. Every `slug` here is illustrative, never read or matched by
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
    slug: '010',
    name: 'Środki trwałe',
    normalBalance: 'DEBIT',
    accountGroupCode: '0',
    accounts: [
      { slug: '010-1', description: 'Budynki i lokale' },
      { slug: '010-2', description: 'Maszyny i urządzenia techniczne' },
      { slug: '010-3', description: 'Środki transportu' },
    ],
  },
  {
    slug: '020',
    name: 'Wartości niematerialne i prawne',
    normalBalance: 'DEBIT',
    accountGroupCode: '0',
    accounts: [{ slug: '020-1', description: 'Licencje i oprogramowanie' }],
  },
  {
    slug: '070',
    name: 'Umorzenie środków trwałych',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ slug: '070-1', description: 'Umorzenie środków trwałych' }],
  },
  {
    slug: '071',
    name: 'Umorzenie wartości niematerialnych i prawnych',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ slug: '071-1', description: 'Umorzenie wartości niematerialnych i prawnych' }],
  },
  {
    slug: '072',
    name: 'Odpisy aktualizujące środki trwałe oraz wartości niematerialne i prawne',
    normalBalance: 'CREDIT',
    accountGroupCode: '0',
    accounts: [{ slug: '072-1', description: 'Odpisy aktualizujące środki trwałe oraz WNiP' }],
  },

  // Zespół 1 — Środki pieniężne, rachunki bankowe i inne krótkoterminowe aktywa finansowe
  {
    slug: '100',
    name: 'Kasa',
    normalBalance: 'DEBIT',
    accountGroupCode: '1',
    accounts: [{ slug: '100-1', description: 'Kasa złotowa' }],
  },
  {
    slug: '130',
    name: 'Rachunki bankowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '1',
    accounts: [
      { slug: '130-1', description: 'Rachunek bieżący PLN' },
      { slug: '130-2', description: 'Rachunek walutowy EUR' },
    ],
  },

  // Zespół 2 — Rozrachunki i roszczenia
  {
    slug: '200',
    name: 'Rozrachunki z odbiorcami',
    normalBalance: 'DEBIT',
    accountGroupCode: '2',
    accounts: [{ slug: '200-1', description: 'Rozrachunki z odbiorcami krajowymi' }],
  },
  {
    slug: '210',
    name: 'Rozrachunki z dostawcami',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ slug: '210-1', description: 'Rozrachunki z dostawcami krajowymi' }],
  },
  {
    slug: '220',
    name: 'VAT naliczony',
    normalBalance: 'DEBIT',
    accountGroupCode: '2',
    accounts: [{ slug: '220-1', description: 'VAT naliczony podlegający odliczeniu' }],
  },
  {
    slug: '221',
    name: 'VAT należny',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ slug: '221-1', description: 'VAT należny' }],
  },
  {
    slug: '225',
    name: 'Rozrachunki z ZUS',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ slug: '225-1', description: 'Rozrachunki z ZUS' }],
  },
  {
    slug: '230',
    name: 'Rozrachunki z tytułu wynagrodzeń',
    normalBalance: 'CREDIT',
    accountGroupCode: '2',
    accounts: [{ slug: '230-1', description: 'Rozrachunki z pracownikami z tytułu wynagrodzeń' }],
  },

  // Zespół 3 — Materiały i towary
  {
    slug: '300',
    name: 'Rozliczenie zakupu',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ slug: '300-1', description: 'Rozliczenie zakupu materiałów i towarów' }],
  },
  {
    slug: '310',
    name: 'Materiały',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ slug: '310-1', description: 'Materiały w magazynie' }],
  },
  {
    slug: '330',
    name: 'Towary',
    normalBalance: 'DEBIT',
    accountGroupCode: '3',
    accounts: [{ slug: '330-1', description: 'Towary w magazynie' }],
  },

  // Zespół 4 — Koszty według rodzajów i ich rozliczenie
  {
    slug: '400',
    name: 'Amortyzacja',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '400-1', description: 'Amortyzacja środków trwałych' }],
  },
  {
    slug: '401',
    name: 'Zużycie materiałów i energii',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [
      { slug: '401-1', description: 'Zużycie materiałów' },
      { slug: '401-2', description: 'Zużycie energii' },
    ],
  },
  {
    slug: '402',
    name: 'Usługi obce',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '402-1', description: 'Usługi obce' }],
  },
  {
    slug: '403',
    name: 'Podatki i opłaty',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '403-1', description: 'Podatki i opłaty' }],
  },
  {
    slug: '404',
    name: 'Wynagrodzenia',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '404-1', description: 'Wynagrodzenia' }],
  },
  {
    slug: '405',
    name: 'Ubezpieczenia społeczne i inne świadczenia',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '405-1', description: 'Ubezpieczenia społeczne' }],
  },
  {
    slug: '409',
    name: 'Pozostałe koszty rodzajowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '4',
    accounts: [{ slug: '409-1', description: 'Pozostałe koszty rodzajowe' }],
  },

  // Zespół 5 — Koszty według typów działalności i ich rozliczenie
  {
    slug: '550',
    name: 'Koszty zarządu',
    normalBalance: 'DEBIT',
    accountGroupCode: '5',
    accounts: [{ slug: '550-1', description: 'Koszty zarządu' }],
  },
  {
    slug: '552',
    name: 'Koszty sprzedaży',
    normalBalance: 'DEBIT',
    accountGroupCode: '5',
    accounts: [{ slug: '552-1', description: 'Koszty sprzedaży' }],
  },

  // Zespół 6 — Produkty i rozliczenia międzyokresowe
  {
    slug: '600',
    name: 'Produkty gotowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '6',
    accounts: [{ slug: '600-1', description: 'Wyroby gotowe' }],
  },
  {
    slug: '640',
    name: 'Rozliczenia międzyokresowe kosztów czynne',
    normalBalance: 'DEBIT',
    accountGroupCode: '6',
    accounts: [{ slug: '640-1', description: 'Rozliczenia międzyokresowe kosztów czynne' }],
  },

  // Zespół 7 — Przychody i koszty związane z ich osiągnięciem
  {
    slug: '700',
    name: 'Przychody ze sprzedaży produktów',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ slug: '700-1', description: 'Przychody ze sprzedaży produktów' }],
  },
  {
    slug: '701',
    name: 'Koszt sprzedanych produktów',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ slug: '701-1', description: 'Koszt sprzedanych produktów' }],
  },
  {
    slug: '730',
    name: 'Przychody ze sprzedaży towarów',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ slug: '730-1', description: 'Przychody ze sprzedaży towarów' }],
  },
  {
    slug: '731',
    name: 'Wartość sprzedanych towarów w cenie zakupu',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ slug: '731-1', description: 'Wartość sprzedanych towarów w cenie zakupu' }],
  },
  {
    slug: '750',
    name: 'Przychody finansowe',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ slug: '750-1', description: 'Przychody finansowe' }],
  },
  {
    slug: '751',
    name: 'Koszty finansowe',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ slug: '751-1', description: 'Koszty finansowe' }],
  },
  {
    slug: '760',
    name: 'Pozostałe przychody operacyjne',
    normalBalance: 'CREDIT',
    accountGroupCode: '7',
    accounts: [{ slug: '760-1', description: 'Pozostałe przychody operacyjne' }],
  },
  {
    slug: '761',
    name: 'Pozostałe koszty operacyjne',
    normalBalance: 'DEBIT',
    accountGroupCode: '7',
    accounts: [{ slug: '761-1', description: 'Pozostałe koszty operacyjne' }],
  },

  // Zespół 8 — Kapitały (fundusze) własne, fundusze specjalne i wynik finansowy
  {
    slug: '800',
    name: 'Kapitał (fundusz) podstawowy',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ slug: '800-1', description: 'Kapitał (fundusz) podstawowy' }],
  },
  {
    slug: '820',
    name: 'Rozliczenie wyniku finansowego',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ slug: '820-1', description: 'Rozliczenie wyniku finansowego' }],
  },
  {
    slug: '840',
    name: 'Rozliczenia międzyokresowe przychodów',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    // PR forward-pointer (Deferred Revenue, PR #6193): the account
    // `RevenueDeferral` records against until the recognition schedule
    // accrues it into `700`/`730` — the credit-side counterpart to `640`.
    accounts: [{ slug: '840-1', description: 'Rozliczenia międzyokresowe przychodów' }],
  },
  {
    slug: '860',
    name: 'Wynik finansowy',
    normalBalance: 'CREDIT',
    accountGroupCode: '8',
    accounts: [{ slug: '860-1', description: 'Wynik finansowy' }],
  },
]
