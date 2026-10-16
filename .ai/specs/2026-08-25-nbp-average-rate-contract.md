# Explicit NBP Average-Rate Contract

**Date:** 2026-08-25
**Status:** Ready for implementation
**Related issue:** [TraceCore #866 — SAL-016A](https://github.com/vloneskorpion/tracecore/issues/866)

## TLDR

**Key points:**

- Add an explicit, additive Open Mercato contract for official NBP average rates from tables A and B without changing the existing table-C `NBP` provider semantics.
- Let callers select a rate by provider and rate type so an accounting or tax module can request exactly one foreign-currency-to-PLN `average` rate from `nbp_average`.

**Scope:**

- Extend the `currencies` provider, persistence, lookup, REST read-model, OpenAPI, and UI contracts with `average`, provider selection mode, and an NBP publication reference.
- Add an explicit-only `nbp_average` provider which reads tables A and B, stores `mid`, `effectiveDate`, and table number `no`, and never derives reciprocal rates.
- Preserve organization/tenant scope, existing default lookup/fetch results, and all current `NBP` table-C behavior.

**Concerns:**

- NBP publishes no table on some dates and tables A and B have different schedules; one missing table is not an error, but malformed data or a failed non-404 request must reject the whole provider batch.
- A new nullable database column is required. It is additive and needs no backfill, but the entity snapshot and generated migration must remain synchronized.

## Overview

Open Mercato already fetches NBP table-C bid/ask rates through the provider whose frozen source is `NBP`. That provider is appropriate for bank buy/sell rates, not for an official NBP average rate. This feature adds a separate provider with the frozen source `nbp_average` and makes selection explicit in the public `ExchangeRateService` contract.

The target consumers are application modules that need an authoritative published rate rather than an arbitrary first result from a list of sources. They receive a directional rate, its effective date, type, source, and the publication identifier needed to trace it back to an NBP table. The currencies module remains responsible only for rate facts and fallback lookup; the consuming module remains responsible for choosing the business date and applying domain or legal rules.

### Sources and market reference

- The [official NBP Web API documentation](https://api.nbp.pl/) defines tables A and B as average-rate tables with `Mid`, identifies table C as bid/ask, and documents table lookup by date and `404` for a date without data.
- The [official NBP publication schedule](https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/informacja-o-terminach-publikacji-kursow-walut/) explains that table A is normally published on business days, table B weekly, and table C on business days. This is why table-level `404` is a normal absence rather than a provider failure.
- ERPNext's open-source `get_exchange_rate` implementation in [`erpnext/setup/utils.py`](https://github.com/frappe/erpnext/blob/develop/erpnext/setup/utils.py) was used as a market reference. This design adopts explicit transaction date and buy/sell-style selection. It rejects ERPNext's implicit generic endpoint choice and reciprocal derivation for this provider because an official NBP publication must preserve the published direction, value, effective date, and table identity.

## Problem Statement

The current built-in `NBPProvider` reads NBP table C. It persists table-C bid as a foreign-currency-to-PLN `buy` rate and inverse ask as a PLN-to-foreign-currency `sell` rate. Those values are not the NBP average rate published as `Mid` in tables A and B.

`ExchangeRateService.getRate()` currently returns every active rate for a pair and date. Its public options do not select a provider or rate type, and its default auto-fetch path invokes every registered provider. A consumer therefore cannot express “return only the official NBP average rate” through a stable contract. Registering an average provider without visibility rules would also silently add rates to existing unfiltered callers.

The persisted `ExchangeRate` record has no source-publication reference. Even if a new provider stored the correct value, downstream users could not identify which NBP table publication produced it.

The missing contract causes four concrete ambiguities:

1. “NBP rate” can mean table-C buy/sell or table-A/B average.
2. A caller cannot constrain lookup or auto-fetch to one provider.
3. A caller cannot request `average` as a supported rate type.
4. A stored rate cannot retain the official publication number.

## Proposed Solution

Extend `packages/core/src/modules/currencies` additively:

1. Introduce a shared `RateType = 'buy' | 'sell' | 'average'`, an optional provider `selectionMode`, and an optional `externalReference` on provider results and persisted exchange rates.
2. Register a dedicated `NBPAverageRateProvider` with source `nbp_average`, base currency `PLN`, and `selectionMode: 'explicit'`.
3. Extend `ExchangeRateService` options with `provider` and `rateType`. Unfiltered reads and default auto-fetch exclude explicit-only providers. Explicit selection validates the provider and passes that provider through the existing fetch path.
4. Preserve the current unique key `(organization, tenant, pair, date, source)`. Reject a provider batch if one key contains conflicting rate types; do not widen uniqueness to include `type`.
5. Add a nullable `external_reference` column and expose it as `externalReference` in TypeScript and REST JSON.
6. Update current fetching configuration and exchange-rate screens so operators can enable/fetch `nbp_average`, see `average`, filter it, and view the publication reference.

### MVP and deferred work

The MVP is exactly FR-1 through FR-5: the additive contracts, NBP A/B provider, explicit lookup/fetch semantics, provenance storage, and visibility in the existing API/UI. These parts ship together because no subset gives a consumer a complete, backward-compatible official-average-rate capability.

Deferred and explicitly out of scope are a currency-conversion endpoint, tax/legal date selection, document-total conversion, automatic reciprocal rates, arbitrary NBP table/range queries, provider preference ranking, retries/circuit breakers beyond the existing timeout, and changes to the existing table-C `NBP` provider.

### Design decisions

| Decision | Rationale |
|---|---|
| One specification | The generic selector and the first explicit provider form one usable vertical capability and share the same compatibility rules. Shipping either half alone provides no complete consumer contract. |
| Provider source is exactly `nbp_average` | The ID is machine-readable, distinct from frozen `NBP`, compatible with current source validation, and explicitly approved for this feature. |
| Existing `NBP` remains unchanged | Renaming it or changing it from table C would be a semantic breaking change for stored data, configs, API callers, and UI. |
| `selectionMode: 'explicit'` is provider metadata | The rule belongs to provider registration and also works for future opt-in providers; it avoids hard-coding `nbp_average` in lookup logic. Missing mode means `default` for backward compatibility. |
| Tables A and B are one provider | Together they are NBP's average-rate publication surface. One provider gives callers a single stable source while retaining each table's `No` on individual records. |
| Only foreign currency → PLN is emitted | It is the direction directly published by `Mid` (“1 unit of foreign currency equals Mid PLN”). Reciprocal calculation would create a derived value, not an official publication. |
| `externalReference` is read-only provider metadata | Manual create/update contracts do not accept it. Provider ingestion owns provenance; operators can see it but cannot accidentally falsify it through CRUD forms. |
| Existing unique key is retained | A source publishes at most one value per pair/effective date. Adding `type` to uniqueness would allow ambiguous results and weaken the requested single-rate contract. |
| No cache is added | Current reads query scoped `ExchangeRate` data directly. Adding a cache would introduce invalidation and freshness concerns without evidence of a performance need. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Change existing `NBP` to tables A/B | Breaks the meaning of existing rates and configurations and removes table-C buy/sell behavior. |
| Eject `currencies` in each standalone app | Duplicates a generally useful framework capability and creates an upgrade fork. The requested outcome is an upstream core contract. |
| Infer average rates from table-C bid/ask | The result would not be the official NBP `Mid` value and would lack a valid A/B publication reference. |
| Emit PLN → foreign-currency inverse rates | Inversion creates derived precision and rounding semantics and can be mistaken for an officially published rate. |
| Return `nbp_average` in existing unfiltered calls | Changes result counts and provider preference for callers that did not opt in. |
| Add a separate NBP table-A provider and table-B provider | Forces consumers to understand table membership and choose between publications when the business request is simply “official NBP average rate.” |
| Add `type` to the unique key | Allows multiple same-source records for a pair/date and defeats deterministic provider selection. |

## User Stories / Use Cases

- **A consuming module** wants to request `provider: 'nbp_average'` and `rateType: 'average'` for a business-selected date so it receives an unambiguous official NBP rate.
- **An operator** wants to enable and schedule NBP average-rate fetching independently of table-C NBP rates so opt-in behavior is visible and controllable.
- **An auditor or support user** wants to see the NBP table number next to a stored rate so its origin can be verified.
- **An existing integration** wants to keep calling `getRate()` without new options and receive the same class of default-provider results as before.
- **A developer** wants invalid provider, rate type, date, and lookback values rejected deterministically rather than converted into a silent empty result.

## Functional Requirements

### FR-1 — Shared rate and provider contracts

1. Export `RateType` from `services/providers/base.ts` as `'buy' | 'sell' | 'average'`.
2. `RateProviderResult.type` uses `RateType | null` and gains `externalReference?: string | null`.
3. `RateProvider` gains `readonly selectionMode?: 'default' | 'explicit'`.
4. An omitted `selectionMode` is interpreted as `default`; existing and third-party providers require no code change.
5. Export `NBP_AVERAGE_PROVIDER_SOURCE` with the frozen value `nbp_average` from the provider module.

### FR-2 — NBP average provider

1. `NBPAverageRateProvider` implements `RateProvider` and declares:
   - `name = 'NBP average rates (tables A/B)'`;
   - `source = NBP_AVERAGE_PROVIDER_SOURCE`;
   - `providerBaseCurrency = 'PLN'`;
   - `selectionMode = 'explicit'`.
2. It uses the existing `CURRENCY_RATE_FETCH_TIMEOUT_MS` resolution and `fetchWithTimeout`; it introduces no new environment variable.
3. For requested date `YYYY-MM-DD`, it calls HTTPS endpoints:
   - `/api/exchangerates/tables/a/{date}/?format=json`;
   - `/api/exchangerates/tables/b/{date}/?format=json`.
4. The two independent HTTP requests may execute concurrently, but the provider validates both outcomes before returning any rate.
5. A `404` from either table means “no publication in this table for this date.” Two `404` responses produce an empty successful batch.
6. Any non-404 non-2xx status, timeout, invalid JSON, unexpected table identifier, missing/invalid `no`, invalid `effectiveDate`, missing/oversized rates array, invalid currency code, or non-finite/non-positive `mid` rejects the whole provider call. `no` is trimmed, limited to 100 characters, and must identify the returned A/B table; `rates` is capped at 500 rows.
7. A successful response must be an array containing exactly one table record whose table is the requested `A` or `B`.
8. `effectiveDate` must equal the requested calendar date and is parsed as midnight UTC (`YYYY-MM-DDT00:00:00.000Z`). The stored date is always NBP's validated `effectiveDate`.
9. Every accepted NBP row emits exactly one result:
   - `fromCurrencyCode = row.code`;
   - `toCurrencyCode = 'PLN'`;
   - `rate = String(row.mid)` after positive finite validation;
   - `type = 'average'`;
   - `source = 'nbp_average'`;
   - `date = EffectiveDate` at midnight UTC;
   - `externalReference = response.no`.
10. No reciprocal PLN → foreign-currency result is emitted and no division or averaging is performed.
11. Results whose source or target currency is not active in the current organization/tenant continue to be filtered by `RateFetchingService`.
12. If PLN is unavailable in the scoped active currency set, the provider returns an empty batch without calling NBP.
13. If A and B contain the same currency code for the same effective date, the provider rejects the whole batch and identifies the duplicate currency in the error. It must not pick a table silently.

### FR-3 — Fetch selection and persistence

1. When `FetchOptions.providers` is absent or empty, `RateFetchingService.fetchRatesForDate()` invokes only providers whose effective selection mode is `default`.
2. When `FetchOptions.providers` is non-empty, it invokes exactly those registered sources in caller order, including explicit-only providers.
3. Unknown/unavailable provider behavior remains represented in the existing `FetchResult.errors`/`byProvider` contract.
4. `RateFetchingService` exposes read-only provider-registry queries needed by `ExchangeRateService`:
   - `hasProvider(source: string): boolean`;
   - `getProviderSources(selectionMode?: 'default' | 'explicit'): string[]`.
   These methods return values/copies, not the mutable provider map.
5. Before persistence, a batch is checked for duplicate composite keys `(fromCurrencyCode, toCurrencyCode, date, source)`. If one key carries different `type` values, the whole provider batch is rejected before the transaction. Identical duplicate keys may be deterministically collapsed; conflicting rate/reference values must be rejected.
6. Persistence remains one transaction per provider outcome. A failed validation or database write stores zero rows from that provider outcome.
7. Create and update paths copy `externalReference ?? null` alongside rate and type.
8. Existing records matched by the unique key are updated in place, including publication reference. Re-fetching the same publication is idempotent.
9. Organization and tenant IDs come exclusively from the trusted `scope`; provider data can never set them.

### FR-4 — Explicit lookup contract

1. `GetRateParams.options` and `GetRatesParams.options` gain:

   ```ts
   provider?: string
   rateType?: RateType
   ```

2. Existing `maxDaysBack` and `autoFetch` remain source- and behavior-compatible.
3. Validate before any database query or external fetch:
   - `date` is a valid finite `Date` and is not after today in UTC;
   - `maxDaysBack` is an integer from `0` through `366`;
   - `autoFetch` is boolean when supplied;
   - `provider`, when supplied, is a non-empty trimmed string and names a registered provider;
   - `rateType`, when supplied, is `buy`, `sell`, or `average`;
   - currency codes remain distinct ISO-style uppercase three-letter codes after normalization.
4. With `provider`, every database lookup filters `source = provider` and an auto-fetch passes `{ providers: [provider] }`.
5. Without `provider`, database lookup excludes all sources currently registered as `explicit`. Auto-fetch invokes only default providers through FR-3.
6. With `rateType`, every database lookup filters `type = rateType`.
7. With neither new option, callers retain current semantics over default providers: all active default-provider rates for the first matching date are returned.
8. With `provider: 'nbp_average'` and `rateType: 'average'`, a successful result contains at most one rate because the persistent unique key excludes duplicates for the selected source/pair/date.
9. Fallback searches requested date first and then each preceding UTC calendar day up to `maxDaysBack`; total checks remain `maxDaysBack + 1`.
10. Day subtraction uses UTC calendar arithmetic. It must not use local-time `setDate`, which can cross DST boundaries inconsistently.
11. A selected provider is used on every fallback auto-fetch attempt. The service never falls back from an explicitly selected provider to a different source.
12. Batch `getRates()` passes the same normalized options to every pair and retains the current per-pair error capture in `RateResult.error`.

### FR-5 — REST, OpenAPI, and UI visibility

1. `GET /api/currencies/exchange-rates` adds `average` to the `type` filter and serializes `externalReference: string | null` on every row.
2. Its OpenAPI list-item schema includes `externalReference` and constrains `type` to `buy | sell | average | null`.
3. Manual POST/PUT inputs allow `type: 'average'` but do not accept or mutate `externalReference`.
4. `POST /api/currencies/fetch-rates` validates its body before constructing a date or calling the service. `providers` is an optional, unique array of 1–20 trimmed non-empty strings and may contain `nbp_average`; an invalid body returns `400` without I/O.
5. Because this custom write route is touched, its metadata is converted to the required per-method form: `POST: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] }`, and it is wired through the canonical mutation-guard registry as an `update` action. It collects registered guards, appends the legacy bridge when present, passes `{ userFeatures }`, uses the guard-modified payload, returns the guard error response when blocked, and runs after-success callbacks after committed writes while logging callback failures. Authentication and authorization do not otherwise change.
6. `providerSchema` and the fetching-configuration UI include `nbp_average` as a distinct provider. Existing stored configurations remain valid.
7. The exchange-rate list adds a localized publication-reference column, renders `average` as a neutral/info semantic `Badge`, and adds `average` to the type filter.
8. The create/edit form adds the localized `average` type option. The publication reference is not editable.
9. The fetch configuration screen labels the new provider as NBP average rates from tables A/B and clearly distinguishes existing NBP table-C buy/sell rates.
10. All user-facing strings are translated in the five currencies locales: `de`, `en`, `es`, `ko`, and `pl`.

## Non-Functional Requirements

1. **Backward compatibility:** all additions are optional or nullable; current method calls, providers, rows, and request payloads remain valid.
2. **Isolation:** all reads and writes remain scoped by both `tenantId` and `organizationId`.
3. **Precision:** do not derive reciprocal values. Persist NBP `Mid` as a numeric string within current `numeric(18,8)` validation and storage limits.
4. **Determinism:** the same provider/date/payload produces the same composite keys and values; ambiguous table overlap fails loudly.
5. **Latency:** A/B calls may run concurrently and reuse the 15-second default timeout. No retry loop is added inside the provider.
6. **Observability:** provider logs include source, requested date, table outcome, count, and sanitized error category. They must not log tenant data beyond existing scope identifiers or raw response bodies.
7. **Security:** only HTTPS official NBP endpoints are called; response shape is treated as untrusted input and validated before persistence.
8. **No new runtime dependency:** use current Zod, HTTP, logger, ORM, UI, and date primitives.
9. **Output safety:** publication references and provider names are rendered as ordinary React text, never raw HTML. Raw NBP bodies and secrets are not logged or returned in errors.
10. **Encoding:** the provider constructs the URL only from its constant official base/table identifier and an internally formatted `YYYY-MM-DD` value; the date path segment is encoded. No response value is interpolated into a URL, file path, HTML, or SQL string.

## Architecture

### Component flow

```text
Consumer / fetch API / scheduled fetch config
                  |
                  v
       ExchangeRateService (selection + UTC fallback)
                  |
          cache miss + autoFetch
                  v
       RateFetchingService (provider registry)
                  |
          explicit provider requested
                  v
 NBPAverageRateProvider --HTTPS--> NBP tables A and B
                  |
       validate + merge + detect overlap
                  v
 RateFetchingService provider transaction
                  |
                  v
      scoped exchange_rates rows
                  |
                  v
 service result / REST read model / backend DataTable
```

### Provider registration and selection

`di.ts` registers `NBPAverageRateProvider` next to the existing `NBPProvider` and `RaiffeisenPolandProvider`. `RateFetchingService.registerProvider()` remains the single registry path, including externally registered providers from `listCurrencyRateProviders()`.

Selection is determined from registered provider metadata, not from a second constant list:

| Call shape | Read sources | Auto-fetch sources |
|---|---|---|
| No `provider` | Registered providers with effective mode `default`, plus historical/manual sources not registered as explicit | Registered default providers only |
| `provider: 'NBP'` | `NBP` only | `NBP` only |
| `provider: 'nbp_average'` | `nbp_average` only | `nbp_average` only |
| Unknown `provider` | Validation error before read | None |

Historical/manual sources are not globally hidden. The unfiltered query excludes only sources of currently registered explicit providers, which is the minimum compatibility guard required for opt-in providers.

### NBP response boundary

The provider owns a private Zod-compatible response schema conceptually equivalent to:

```ts
type NbpAverageTableResponse = Array<{
  table: 'A' | 'B'
  no: string
  effectiveDate: string
  rates: Array<{
    currency: string
    code: string
    mid: number
  }>
}>
```

The provider does not expose NBP DTOs as public contracts. It maps them immediately to `RateProviderResult` after whole-response validation.

### Persistence and transaction boundary

Provider fetches are read-only external I/O and occur before opening a database transaction. `RateFetchingService` validates the complete returned batch, then performs one existing transaction per provider outcome:

1. Load all potentially matching scoped rows in one query.
2. Index them by the existing composite key.
3. Update or create every result, including `type` and `externalReference`.
4. Flush once.

If validation, lookup, insert/update, or flush fails, the provider transaction rolls back and its stored count is zero. There is no cross-provider transaction: the existing fetch result intentionally isolates provider failures.

Provider ingestion stays in the existing internal service rather than introducing a user command. It is an idempotent synchronization operation with no meaningful operator undo; fetched publications can be corrected by re-fetching the authoritative source. Manual CRUD mutations continue through `currencies.exchange_rates.*` commands with audit snapshots and undo/redo. Their snapshots gain `externalReference` so undo/redo never drops provider provenance, even though manual input cannot modify it.

### Mutation guard boundary

`POST /api/currencies/fetch-rates` remains an action endpoint but is a custom write route. Before invoking the fetch service it runs `getAllMutationGuardInstances()`, appends `bridgeLegacyGuard(container)` when available, and calls `runMutationGuards(...)` with operation `update`, the scoped `currencies.fetch_rates` resource context, validated payload, and caller features. It uses `modifiedPayload` as the effective input. After the fetch transaction and fetch-config status update commit, it executes `afterSuccessCallbacks`; callback failures are logged and do not turn a committed write into an HTTP failure.

### Events, cache, search, and jobs

- No new domain event is introduced. Existing manual CRUD side effects remain unchanged.
- No new cache or query-index entry is introduced; exchange-rate lookups continue to use direct scoped ORM queries.
- Existing scheduled fetching continues to pass the configured provider explicitly. Enabling a `nbp_average` fetch config therefore opts that organization into scheduled ingestion.
- No new worker, queue, search mapping, notification, custom field, or encryption map is required.

### Frontend Architecture Contract

#### Server/client boundary map

| Surface | Current boundary | Planned change |
|---|---|---|
| `backend/config/currency-fetching/page.tsx` | Async server page | No boundary change; it continues to render the client configuration component. |
| `components/CurrencyFetchingConfig.tsx` | Existing client component | Add provider label/description/config entry only. No new context, provider, or fetch abstraction. |
| `backend/exchange-rates/page.tsx` | Existing client DataTable host | Add one field to the row type, one column, and one filter/badge branch. |
| `backend/exchange-rates/create/page.tsx` | Existing client form page | No file change; it consumes the updated shared form configuration. |
| `backend/exchange-rates/[id]/page.tsx` | Existing client form page | No file change; it consumes the updated shared form configuration and preserves provider provenance by omitting it from writes. |
| `lib/exchangeRateFormConfig.ts` | Shared browser-safe form helper | Add `average` option only. |

#### `"use client"` ledger

No new client boundary is allowed. The only client files in scope already declare `"use client"`:

| File | Why client-side | State/data ownership |
|---|---|---|
| `components/CurrencyFetchingConfig.tsx` | Interactive switches, time input, fetch-now mutation | Existing local config/fetch state and shared organization scope headers. |
| `backend/exchange-rates/page.tsx` | DataTable filters, paging, delete mutation | Existing list state loaded via `apiCall`. |
| `backend/exchange-rates/create/page.tsx` | CrudForm submission and navigation | Existing CrudForm state. |
| `backend/exchange-rates/[id]/page.tsx` | Record load, CrudForm, navigation | Existing record/form state. |

#### Client blob guardrails and budgets

- No new browser dependency, React context, top-level provider, global store, custom hook, or client-side business service.
- NBP fetching, validation, lookup fallback, and source selection remain server-only.
- Change budget, excluding tests and translations:
  - `CurrencyFetchingConfig.tsx`: at most 30 net new lines;
  - exchange-rate list page: at most 35 net new lines;
  - form helper: at most 10 net new lines.
- If any budget is exceeded, extract only a pure display helper; do not create a new client data layer.
- Bundle verification uses the repository's normal build plus the client-component ledger review. No new chunk should be attributable to this feature.

#### Frontend evidence

- Unit-render the provider config and exchange-rate DataTable changes.
- Extend `TC-CUR-013` if it already covers fetch configuration; otherwise add `TC-CUR-015-nbp-average-rate-contract.spec.ts` under the module `__integration__` folder.
- Playwright evidence must show the new NBP average provider card and an exchange-rate row with type `average` and a publication reference. Tests use deterministic seeded/mocked application data and never call live NBP.

### Performance, query, and scale contract

- Selected lookup is a point/range scan over the existing scoped unique index prefix `(organization_id, tenant_id, from_currency_code, to_currency_code, date[, source])`. The optional type predicate filters an already narrow candidate set; no new index is justified.
- The existing admin list remains page-size 50 (hard API maximum 100) and keeps its existing pagination model. This feature does not create rows unless explicitly enabled, so changing that established API to keyset pagination is outside the MVP.
- One provider attempt performs two bounded HTTP calls concurrently. Persistence performs one active-currency query, one set-based existing-rate query, and one flush per provider; there is no per-rate query/N+1 loop.
- NBP tables contain a bounded currency list far below 1,000 rows. Foreground transaction and set-based upsert remain appropriate; no worker or progress job is needed for one provider/date.
- Service fallback performs at most one scoped rate query and, when enabled and empty, one selected provider attempt per UTC day, bounded by `maxDaysBack <= 366`, and stops at the first matching date.
- No cache is introduced: the expected point lookups are index-supported, writes must be immediately visible, and current APIs have no cache contract. Cold reads fall directly through to the database; therefore there are no cache keys, invalidations, or cross-tenant cache surfaces.

## Data Models

### ExchangeRate (modified)

Existing fields and indexes remain unchanged. Add:

| Property | Database column | Type | Nullability | Ownership |
|---|---|---|---|---|
| `externalReference` | `external_reference` | `text` | Nullable | Provider-supplied source publication identifier; NBP uses table `No`. |

Constraints:

- Keep `exchange_rates_pair_datetime_source_unique` exactly on `organization_id`, `tenant_id`, `from_currency_code`, `to_currency_code`, `date`, and `source`.
- Keep current organization/tenant and pair indexes.
- Do not add a foreign key or cross-module ORM relationship.
- Existing rows have `NULL`; no backfill is needed.
- The field is not sensitive or personal data and requires no encryption map.

### CurrencyFetchConfig (unchanged schema)

No column or constraint changes. Its existing `provider` text value may now be `nbp_average`; `providerSchema` is extended accordingly.

### Public TypeScript contracts

```ts
export type RateType = 'buy' | 'sell' | 'average'
export type ProviderSelectionMode = 'default' | 'explicit'

export interface RateProviderResult {
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  source: string
  date: Date
  type?: RateType | null
  externalReference?: string | null
}

export interface RateProvider {
  readonly name: string
  readonly source: string
  readonly providerBaseCurrency?: string
  readonly selectionMode?: ProviderSelectionMode
  // existing methods unchanged
}

export interface RateSelectionOptions {
  maxDaysBack?: number
  autoFetch?: boolean
  provider?: string
  rateType?: RateType
}
```

`GetRateParams.options` and `GetRatesParams.options` use the exported `RateSelectionOptions`. Existing deep import paths remain valid through the current wildcard package exports.

## API Contracts

### ExchangeRateService.getRate

```ts
const result = await exchangeRateService.getRate({
  fromCurrencyCode: 'EUR',
  toCurrencyCode: 'PLN',
  date: new Date('2026-08-24T00:00:00.000Z'),
  scope: { tenantId, organizationId },
  options: {
    provider: NBP_AVERAGE_PROVIDER_SOURCE,
    rateType: 'average',
    maxDaysBack: 7,
    autoFetch: true,
  },
})
```

Success retains the existing `RateResult` shape. The selected record contains:

```ts
{
  fromCurrencyCode: 'EUR',
  toCurrencyCode: 'PLN',
  rate: '4.2531',
  source: 'nbp_average',
  type: 'average',
  externalReference: '163/A/NBP/2026',
  date: new Date('2026-08-24T00:00:00.000Z')
}
```

Contract notes:

- No matching publication within the fallback window is a successful empty `rates` result with `actualDate: null`, as today.
- Invalid options throw before I/O. `getRates()` captures the error per pair in the existing `error` field.
- Explicit selection never substitutes another provider or another rate type.

### GET /api/currencies/exchange-rates

Existing auth: `currencies.rates.view`.

Additive query option:

```text
type=buy|sell|average
```

Additive response property:

```json
{
  "items": [
    {
      "id": "uuid",
      "fromCurrencyCode": "EUR",
      "toCurrencyCode": "PLN",
      "rate": "4.25310000",
      "date": "2026-08-24T00:00:00.000Z",
      "source": "nbp_average",
      "type": "average",
      "externalReference": "163/A/NBP/2026",
      "isActive": true
    }
  ]
}
```

`externalReference` is always present in serialized rows and is `null` for legacy/manual records without provenance.

### POST /api/currencies/exchange-rates

Existing auth: `currencies.rates.manage`.

The existing request is unchanged except `type` additionally accepts `average`. `externalReference` is not accepted. Unknown keys continue through existing route/command behavior; the command schema must not map this field to the entity.

### PUT /api/currencies/exchange-rates

Existing auth: `currencies.rates.manage`.

The existing request is unchanged except `type` additionally accepts `average`. Updating another field preserves the current `externalReference`; it is not an editable input.

### POST /api/currencies/fetch-rates

Existing auth: `currencies.fetch.manage`.

```ts
type FetchRatesRequest = {
  date?: string
  providers?: string[]
}
```

Example explicit fetch:

```json
{
  "date": "2026-08-24T00:00:00.000Z",
  "providers": ["nbp_average"]
}
```

The response shape is unchanged:

```json
{
  "totalFetched": 32,
  "byProvider": {
    "nbp_average": { "count": 32 }
  },
  "errors": []
}
```

When `providers` is omitted, explicit-only providers are not fetched. The API does not proxy or expose raw NBP payloads.

Response/error behavior:

- `200`: existing `FetchResult`, including provider-level failures in `errors`/`byProvider` as today;
- `400`: malformed JSON/schema/date or a mutation guard's configured client error;
- `401`: missing authenticated organization/tenant context;
- `403` or guard-defined status: missing feature or blocked mutation;
- `500`: unexpected orchestration/persistence failure, using the existing sanitized fetch-result error envelope.

### Fetch configuration API

`POST /api/currencies/fetch-configs` accepts `provider: 'nbp_average'` through the additive provider enum. GET/PUT/DELETE shapes, permissions, optimistic locking, and scope remain unchanged.

## Internationalization (i18n)

Add equivalent keys to every existing locale (`de`, `en`, `es`, `ko`, `pl`):

- `currencies.fetch.provider_nbp_average`
- `currencies.fetch.provider_nbp_average_description`
- `exchangeRates.form.field.typeAverage`
- `exchangeRates.list.type.average`
- `exchangeRates.list.columns.externalReference`

Update the existing NBP description to say “NBP table C buy/sell rates” so the two providers cannot be confused. Do not hard-code NBP labels or fallback text in page components.

## UI/UX

### Fetch configuration

The existing list of provider cards gains one card:

- title: localized “NBP average rates”;
- description: localized “Official average rates from NBP tables A and B”;
- default state: disabled;
- default time: current `09:00` initialization behavior;
- controls: existing semantic `Switch`, `TimeInput`, status badge, and Fetch now button.

The existing NBP card description explicitly names table C and buy/sell rates. No new layout primitive or dialog is introduced.

### Exchange-rate list

- The type column maps `buy`, `sell`, and `average` explicitly; unknown values fall back to neutral text rather than being mislabelled as `sell`.
- `average` uses a semantic non-status/info badge variant already supported by the design system.
- The type filter includes Average.
- A “Publication reference” column shows `externalReference` or an em dash.
- The DataTable keeps its stable extension table ID, existing pagination, row actions, and injection host.

### Create/edit form

The type select gains Average through the shared form helper. `externalReference` is never editable and the shared payload builder omits it, so edits to other fields preserve provider provenance.

## Configuration

- No new environment variables.
- Existing `CURRENCY_RATE_FETCH_TIMEOUT_MS` applies independently to both A and B requests.
- The provider is registered in every currencies module installation but remains inactive in implicit fetch/read flows because it is explicit-only.
- An organization opts in by enabling its `nbp_average` fetch config or by explicitly selecting the provider in service/API calls.

## Migration & Compatibility

### Database migration

1. Add `external_reference text null` to `exchange_rates` in a new generated currencies migration.
2. Update `packages/core/src/modules/currencies/migrations/.snapshot-open-mercato.json` in the same change.
3. Do not edit a historical migration.
4. No backfill, default, lock-heavy index, or data rewrite is required.
5. Run the schema-diff probe after editing the entity. If it generates unrelated churn, keep only the scoped nullable-column migration and the matching snapshot update.

### Backward compatibility matrix

| Surface | Compatibility |
|---|---|
| Existing TypeScript calls | Additive optional options/properties; no call-site change required. |
| Existing provider implementations | `selectionMode` and `externalReference` are optional; omitted mode is `default`. |
| Existing `NBP` source/config/data | Unchanged table-C semantics and source string. |
| Existing unfiltered lookups | Continue to return default-provider and manual/historical rates; registered explicit sources are excluded. |
| Existing default fetch | Continues to fetch default providers only; new provider does not add network traffic. |
| REST responses | Additive nullable property and additive enum member. |
| REST writes | Existing payloads valid; no required field added. |
| Database | Nullable additive column; existing rows valid. |
| Standalone apps | Receive capability in a future `@open-mercato/core` release; no eject required. |

### Deployment and rollback

- Deploy migration before code or in the repository's normal migration-before-app sequence.
- Rollback application behavior by disabling all `nbp_average` fetch configs and stopping explicit calls.
- A binary downgrade that does not know `average` or `external_reference` may leave the nullable column and rows in place; the column is harmless, but average rows should be disabled or removed by an explicit operational migration before downgrade if old UI/validators must edit them.
- Add release/upgrade notes documenting the opt-in provider, public selector, migration, and the unchanged meaning of `NBP`.

## Implementation Plan

### Phase 1 — Contracts and persistence

1. Add `RateType`, `ProviderSelectionMode`, optional provider metadata, and `externalReference` to the provider contracts.
2. Add nullable `ExchangeRate.externalReference`, update manual command snapshots/undo-redo preservation, and extend rate-type validators.
3. Generate and inspect the scoped migration and snapshot update.
4. Extend `RateFetchingService` registry queries, default/explicit selection, batch conflict validation, and provenance persistence.

**Verification:** focused validator, command snapshot, and rate-fetching service tests pass; generated diff contains only `external_reference` plus snapshot metadata.

### Phase 2 — NBP average provider

1. Implement `NBPAverageRateProvider` and frozen source constant.
2. Validate table A/B payloads, date semantics, overlap, positive `Mid`, 404 behavior, and atomic failure behavior.
3. Register the provider in DI and add deterministic mocked unit tests for every response branch.

**Verification:** provider tests use no live network and prove foreign→PLN-only `average` output with the correct table number.

### Phase 3 — Explicit lookup

1. Add and export `RateSelectionOptions` on single/batch service parameters.
2. Validate options and implement source/type query filters and UTC fallback.
3. Pass an explicitly selected source through auto-fetch without fallback to other providers.
4. Update service documentation with selected and legacy examples.

**Verification:** service tests prove compatibility, explicit-only exclusion, exact selection, invalid-option rejection, weekend fallback, UTC/DST behavior, and batch error capture.

### Phase 4 — REST and UI

1. Extend exchange-rate REST filtering/serialization/OpenAPI and fetch route validation/metadata.
2. Add the provider config option and localized provider distinction.
3. Add Average and Publication reference to the existing DataTable/form surfaces.
4. Update all five locales and component tests.

**Verification:** route/OpenAPI and component tests pass; DataTable retains its stable extension table ID; no new client boundary or hard-coded label is introduced.

### Phase 5 — Integration, compatibility, and documentation

1. Add/extend deterministic currencies integration coverage for opt-in config, explicit fetch/lookup, and UI evidence without live NBP.
2. Run currencies tests, typecheck, lint, build, full relevant integration checks, and backwards-compatibility checks.
3. Update `services/README.md` and `UPGRADE_NOTES.md`.
4. Re-run schema diff to ensure the snapshot is clean.

**Verification:** all gates pass and UI evidence shows both the provider card and stored provenance.

### Task table

| # | Deliverable | Dependencies | Acceptance evidence |
|---:|---|---|---|
| 1 | Shared additive contracts | None | Type tests/typecheck; legacy provider fixtures compile unchanged. |
| 2 | Entity + migration + snapshot | 1 | Scoped SQL diff; validator and command snapshot tests. |
| 3 | Explicit/default fetch registry | 1 | RateFetchingService default/explicit and conflict tests. |
| 4 | NBP A/B provider + DI | 1, 3 | Mocked table A/B/404/error/overlap tests. |
| 5 | Selected lookup + UTC fallback | 3 | ExchangeRateService provider/type/DST tests. |
| 6 | REST/OpenAPI contracts | 1, 2, 5 | Route serialization/filter/body-validation tests. |
| 7 | Fetch config + exchange-rate UI | 1, 6 | Component tests and localized UI evidence. |
| 8 | Integration + docs + BC gate | 1–7 | TC-CUR scenario, build/test/BC results, clean schema diff. |

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/currencies/services/providers/base.ts` | Modify | Add shared rate type, selection mode, and provenance result field. |
| `packages/core/src/modules/currencies/services/providers/nbpAverage.ts` | Create | Implement explicit NBP tables A/B provider and source constant. |
| `packages/core/src/modules/currencies/services/providers/__tests__/nbpAverage.test.ts` | Create | Validate mapping, failures, dates, and atomic A/B merge. |
| `packages/core/src/modules/currencies/services/rateFetchingService.ts` | Modify | Add registry inspection, default/explicit selection, conflict validation, and provenance persistence. |
| `packages/core/src/modules/currencies/services/exchangeRateService.ts` | Modify | Add provider/rate-type selection and UTC-safe fallback validation. |
| `packages/core/src/modules/currencies/services/README.md` | Modify | Document the public selected-rate contract and compatibility behavior. |
| `packages/core/src/modules/currencies/services/__tests__/rateFetchingService.providers.test.ts` | Modify | Cover explicit-only registration/fetch behavior. |
| `packages/core/src/modules/currencies/services/__tests__/rateFetchingService.batching.test.ts` | Modify | Cover conflicting duplicate keys and atomic persistence. |
| `packages/core/src/modules/currencies/services/__tests__/exchangeRateService.test.ts` | Modify | Cover selector, validation, and UTC fallback. |
| `packages/core/src/modules/currencies/data/entities.ts` | Modify | Add nullable `externalReference`. |
| `packages/core/src/modules/currencies/data/validators.ts` | Modify | Add `average` and `nbp_average`. |
| `packages/core/src/modules/currencies/data/__tests__/validators.test.ts` | Modify | Prove additive enum behavior and legacy inputs. |
| `packages/core/src/modules/currencies/migrations/Migration<timestamp>.ts` | Create | Add nullable `external_reference`. |
| `packages/core/src/modules/currencies/migrations/.snapshot-open-mercato.json` | Modify | Synchronize schema snapshot. |
| `packages/core/src/modules/currencies/commands/exchange-rates.ts` | Modify | Preserve provenance in snapshots/undo/redo without accepting it as input. |
| `packages/core/src/modules/currencies/di.ts` | Modify | Register `NBPAverageRateProvider`. |
| `packages/core/src/modules/currencies/api/exchange-rates/route.ts` | Modify | Add average filter, provenance read model, and OpenAPI enum. |
| `packages/core/src/modules/currencies/api/exchange-rates/__tests__/list-pagination.test.ts` | Modify | Cover average filtering and nullable/non-null provenance serialization. |
| `packages/core/src/modules/currencies/api/fetch-rates/route.ts` | Modify | Parse body, use per-method metadata/mutation guards, and document explicit provider request. |
| `packages/core/src/modules/currencies/api/fetch-rates/__tests__/route.test.ts` | Create | Cover request validation, guard lifecycle, and explicit provider pass-through. |
| `packages/core/src/modules/currencies/components/CurrencyFetchingConfig.tsx` | Modify | Add explicit provider card/labels. |
| `packages/core/src/modules/currencies/components/__tests__/CurrencyFetchingConfig.test.tsx` | Modify | Cover initialization and rendering of the new provider. |
| `packages/core/src/modules/currencies/backend/exchange-rates/page.tsx` | Modify | Display/filter average and publication reference. |
| `packages/core/src/modules/currencies/backend/exchange-rates/__tests__/ExchangeRatesPage.test.tsx` | Modify | Cover average badge/filter/reference. |
| `packages/core/src/modules/currencies/lib/exchangeRateFormConfig.ts` | Modify | Add Average form option while omitting provenance from payloads. |
| `packages/core/src/modules/currencies/i18n/{de,en,es,ko,pl}.json` | Modify | Translate provider, Average, and publication reference strings. |
| `packages/core/src/modules/currencies/__integration__/TC-CUR-015-nbp-average-rate-contract.spec.ts` | Create | Deterministic explicit lookup/config/UI proof with no live NBP. |
| `UPGRADE_NOTES.md` | Modify | Document new opt-in behavior and migration. |

## Testing Strategy

### Provider unit tests

- Table A success maps every valid row to foreign→PLN, `average`, correct effective UTC date, and table `No`.
- Table B success maps identically.
- A success + B `404`, A `404` + B success, and both `404` behave as specified.
- Non-404 HTTP failure, timeout, invalid JSON, wrong/empty/multiple table envelope, invalid table ID/date/number/code, and non-positive/non-finite `Mid` reject the whole call.
- A/B duplicate currency on the same effective date rejects the whole call.
- Missing PLN skips both requests.
- No reciprocal rate and no arithmetic transformation are produced.

### Service unit tests

- Existing providers without `selectionMode` remain default.
- Default fetch skips explicit providers; explicit lists can invoke them.
- Registry inspection does not expose mutable internal state.
- Duplicate composite keys with conflicting type/rate/reference reject before persistence.
- Provenance is inserted, updated, and nulled deterministically.
- Unfiltered lookup excludes registered explicit sources but retains manual/unregistered sources.
- Provider-only, rate-type-only, and combined selection produce correct queries/results.
- Selected auto-fetch passes exactly one provider through every fallback attempt.
- Invalid options cause zero DB/provider calls.
- `maxDaysBack` boundary values `0` and `366` pass; negative, fractional, and `367` fail.
- UTC fallback crosses month/year and Europe/Warsaw DST dates without skipping/repeating a calendar day.
- Existing no-option tests remain unchanged and pass.

### Command and API tests

- Manual create/update accepts `average` and rejects other strings.
- Manual update preserves `externalReference`; audit snapshot/undo/redo retains it.
- GET serializes `externalReference` as string or null and filters `average`.
- OpenAPI describes the additive enum and nullable field.
- Fetch-rates rejects malformed date/provider payloads with `400`, retains auth/feature requirements, runs/merges mutation guards and callbacks, and forwards `nbp_average` explicitly.
- Cross-tenant and cross-organization records are never returned or updated.

### UI tests

- Fetch config initializes and renders all three built-in providers with distinct localized descriptions.
- Fetch now sends `providers: ['nbp_average']` only for the new card.
- Exchange list renders Average without mislabelling it as Sell, shows publication reference, and includes the filter option.
- Form payload includes `type: 'average'` and never includes `externalReference`.

### Integration evidence

The integration test creates deterministic scoped currencies and a seeded average-rate record/publication reference through test fixtures or the internal service. It must not call `api.nbp.pl`.

Acceptance path:

1. Sign in with currencies fetch/rates permissions.
2. Open Fetching configuration and verify separate NBP table-C and NBP average A/B cards.
3. Enable `nbp_average` and verify config persistence.
4. Exercise an explicit service/API fetch using a mocked provider response or seeded test provider.
5. Open Exchange rates, filter type Average, and verify pair, source `nbp_average`, and publication reference.
6. Verify another organization cannot read the row.

Capture screenshots of the provider cards and the filtered exchange-rate list as QA artifacts.

### Validation gate

Run the repository commands applicable to changed packages, including:

- currencies unit/component/route tests;
- `yarn typecheck` or package-scoped equivalent;
- `yarn lint`;
- `yarn build`;
- the targeted `TC-CUR-015` integration scenario and the currencies integration suite;
- repository backwards-compatibility checks for exported TypeScript/API/schema changes;
- final schema-diff probe.

## Risks & Impact Review

### Data Integrity Failures

#### Partial A/B publication persistence

- **Scenario**: Table A succeeds but table B times out or returns malformed data, and A rows are persisted before B is validated.
- **Severity**: High
- **Affected area**: `currencies` provider ingestion and downstream selected lookups.
- **Mitigation**: Complete both requests and validate/merge the full provider result before `RateFetchingService` opens its single provider transaction.
- **Residual risk**: NBP may legitimately omit one table with `404`; that documented absence is accepted and explicitly tested.

#### Ambiguous duplicate currency

- **Scenario**: Tables A and B unexpectedly contain the same currency/effective date and one silently overwrites the other under the unique key.
- **Severity**: High
- **Affected area**: Stored rate correctness and audit provenance.
- **Mitigation**: Detect overlap before persistence and reject the entire provider batch with the currency code in the error.
- **Residual risk**: Fetching remains unavailable for that date until NBP data or provider logic is reviewed, which is safer than selecting silently.

#### Concurrent same-date fetch

- **Scenario**: Scheduled and on-demand requests ingest the same source/pair/date concurrently.
- **Severity**: Medium
- **Affected area**: `exchange_rates` writes and fetch status counts.
- **Mitigation**: Retain the database unique constraint, transaction per provider, and idempotent update-by-key behavior; treat a unique race through existing provider error reporting rather than creating duplicates.
- **Residual risk**: One caller may report a transient provider persistence error while the other succeeds; data remains unambiguous.

#### Provenance lost by manual edit/undo

- **Scenario**: An operator edits a fetched row and the new field is cleared because command snapshots do not know it.
- **Severity**: Medium
- **Affected area**: Exchange-rate auditability.
- **Mitigation**: Keep the field read-only and add it to snapshots/redo materialization; update commands preserve it when editing other fields.
- **Residual risk**: Authorized deletion can still remove a rate under existing semantics.

### Cascading Failures & Side Effects

#### NBP outage or throttling

- **Scenario**: Official API times out or returns non-2xx for one/both tables.
- **Severity**: Medium
- **Affected area**: `nbp_average` refresh only; downstream consumers may have no new rate.
- **Mitigation**: Existing timeout, isolated provider outcome, visible fetch status/error, and caller-controlled date fallback. Do not substitute table C or another source.
- **Residual risk**: No new rate is available until a later successful fetch; correctness is preferred over silent fallback.

#### Downstream misuse as legal decision engine

- **Scenario**: A consumer assumes the currencies module chose the legally correct tax date or conversion rule.
- **Severity**: High
- **Affected area**: Accounting/tax modules outside currencies.
- **Mitigation**: Public documentation states that callers choose the business date and legal rule; the service returns only a rate fact and its provenance.
- **Residual risk**: Application code can still pass the wrong date; domain modules must test their own date-selection rules.

### Tenant & Data Isolation Risks

#### Cross-organization rate exposure

- **Scenario**: A selected lookup or re-fetch omits scope while filtering by provider and returns another organization's row.
- **Severity**: Critical
- **Affected area**: Service, REST list, and persistence.
- **Mitigation**: Provider/type predicates are additive to mandatory `tenantId` and `organizationId` predicates; persistence takes scope only from trusted caller context; integration tests use two organizations.
- **Residual risk**: None beyond the existing request-auth boundary.

#### Shared provider registry behavior

- **Scenario**: A custom registered explicit provider changes unfiltered visibility globally or a caller mutates the registry map.
- **Severity**: Medium
- **Affected area**: All organizations using the process.
- **Mitigation**: Selection mode is provider metadata applied consistently per request; inspection methods return copies and never expose the map. Existing providers default to current behavior.
- **Residual risk**: A third-party provider author can intentionally mark their source explicit; this is the documented opt-in contract.

### Migration & Deployment Risks

#### Entity/snapshot drift

- **Scenario**: Entity gains `externalReference` but migration snapshot is not updated, producing later schema churn or a missing production column.
- **Severity**: High
- **Affected area**: Deployment and all rate reads/writes.
- **Mitigation**: Generate a new migration, update the currencies snapshot in the same step, and run a final clean schema-diff probe.
- **Residual risk**: Deployment ordering remains an operational concern covered by standard migration-before-app procedure.

#### Older clients encounter `average`

- **Scenario**: A client exhaustively handles only `buy` and `sell` and displays an unknown value incorrectly.
- **Severity**: Medium
- **Affected area**: External TypeScript/REST consumers.
- **Mitigation**: New values appear only after explicit provider use or manual creation; document the additive enum in upgrade notes and retain no-option behavior.
- **Residual risk**: Exhaustive downstream switches need an additive update, which is unavoidable for a new public semantic value.

### Operational Risks

#### Excessive external requests during fallback

- **Scenario**: A large `maxDaysBack` with auto-fetch requests A and B for every day, creating latency and unnecessary NBP traffic.
- **Severity**: Medium
- **Affected area**: NBP API, request latency, scheduled/on-demand fetch.
- **Mitigation**: Bound `maxDaysBack` at 366, preserve per-request timeout, stop at the first matching date, and require explicit provider selection for NBP average traffic.
- **Residual risk**: A caller can still intentionally request a long empty historical window; future throttling can be added based on observed usage.

#### Publication schedule yields confusing zero counts

- **Scenario**: An operator fetches a weekend/holiday and sees zero rows despite a healthy provider.
- **Severity**: Low
- **Affected area**: Fetch configuration UI and support.
- **Mitigation**: Treat 404 as normal absence, preserve successful zero count, and document fallback lookup versus exact on-demand fetch behavior.
- **Residual risk**: The generic existing warning text may still require operator knowledge of publication schedules.

#### UI bundle or architecture regression

- **Scenario**: A small metadata display grows the existing client pages or adds another global provider.
- **Severity**: Low
- **Affected area**: Backend performance and maintainability.
- **Mitigation**: No new client boundary/provider/dependency; enforce explicit per-file line budgets and build/client-ledger review.
- **Residual risk**: Existing pages are already client components; this feature does not reduce that baseline.

## Final Compliance Report — 2026-08-25

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/currencies/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root `AGENTS.md` | Keep changes minimal and scoped | Compliant | One vertical currencies feature; no app eject, unrelated refactor, new dependency, cache, event, or worker. |
| root `AGENTS.md` | Entity decorators and migration lifecycle | Compliant | Existing entity file is modified; new generated migration plus snapshot and final diff probe are required. |
| root `AGENTS.md` | Never edit historical migrations/generated output | Compliant | File manifest creates a new migration and updates source snapshot only. |
| root `AGENTS.md` | API routes export per-method metadata and OpenAPI | Compliant | Exchange-rate route already complies; touched fetch route is explicitly corrected to per-method metadata and retains OpenAPI. |
| `packages/core/AGENTS.md` | Custom write routes use the mutation guard registry | Compliant | Fetch-rates is specified as an `update` guard action with legacy bridge, caller features, modified payload, blocked response, and post-success callbacks. |
| root `AGENTS.md` | Organization/tenant scope on every entity read/write | Compliant | Selection predicates are always additive to both scope keys; provider payload cannot set scope. |
| root `AGENTS.md` | Use canonical UI and i18n primitives | Compliant | Existing DataTable, CrudForm, Badge/StatusBadge, Switch, TimeInput, `apiCall`, and translations are retained. |
| root `AGENTS.md` | No cross-module ORM relationships | Compliant | One nullable text column only; no relationship. |
| root `AGENTS.md` | Sensitive fields use encryption maps | Compliant / N/A | NBP publication number is public, non-personal provenance. |
| `packages/core/AGENTS.md` | Domain writes through commands with undo | N/A for provider sync; Compliant for user mutations | Manual CRUD stays command/audit/undo based. Existing authoritative provider ingestion is a bounded internal synchronization transaction, not a user domain action; it has rollback/re-fetch semantics and no meaningful undo. Provenance is included in manual snapshots. |
| `packages/core/AGENTS.md` | Backward-compatible public types/functions/APIs/schema | Compliant | Optional properties/options, nullable column, additive enum/source, unchanged existing source. |
| currencies `AGENTS.md` | Preserve rate precision and directional semantics | Compliant | No reciprocal or arithmetic transformation; published Mid is foreign→PLN. |
| currencies `AGENTS.md` | Reuse provider/fetch/service architecture | Compliant | New provider uses the existing registry, fetch service, DI, config, and lookup path. |
| UI AGENTS / DS rules | Stable DataTable host, semantic components/tokens | Compliant | Stable extension table ID retained; no raw form/fetch, arbitrary colors/sizes, or inline SVG. |
| frontend architecture contract | Declare boundaries, client ledger, budgets, evidence | Compliant | Full contract is included under Architecture. |
| `.ai/qa/AGENTS.md` | Deterministic integration tests; no external service dependency | Compliant | NBP is mocked/seeded; module integration test and screenshot evidence required. |
| `BACKWARD_COMPATIBILITY.md` | Stable types, functions, REST, DI, and database schema | Compliant | Additive optional/nullable changes; existing DI keys and paths unchanged; migration is additive. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | `external_reference` ↔ `externalReference`; type enum includes Average at persistence, service, REST, and UI layers. |
| API contracts match UI/UX section | Pass | UI consumes the additive GET field/filter and fetch-config provider enum; provenance stays read-only. |
| Risks cover all write operations | Pass | Provider transaction, concurrent fetch, manual edit/undo, migration, and config opt-in are covered. |
| Commands defined for all user mutations | Pass | Manual exchange-rate and config mutations retain existing command paths; provider ingestion exception is explicit and transactional. |
| Cache strategy covers all read APIs | Pass | No cache exists or is introduced; direct scoped reads avoid invalidation gaps. |
| Security and output encoding are explicit | Pass | NBP payloads are schema-validated, URLs use constant/encoded segments, UI renders plain React text, and raw bodies are not logged. |
| Default behavior remains backward compatible | Pass | Explicit providers are excluded from unfiltered reads and implicit fetch; existing providers default to current mode. |
| Provider output matches NBP contract | Pass | Tables A/B `Mid`, `EffectiveDate`, `No`; foreign→PLN only. |
| Implementation phases cover every requirement | Pass | Contracts, schema, provider, lookup, API/UI, tests, docs, and BC gate all map to tasks. |

### Non-Compliant Items

None identified. The provider-ingestion command exception is an existing internal synchronization boundary, is not user-triggered domain CRUD, is transactionally specified, and does not weaken manual command/audit behavior.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-25

- Finalized one cohesive specification after scope confirmation.
- Froze provider source as `nbp_average` and preserved existing `NBP` table-C semantics.
- Added complete provider, selection, data, REST, UI, migration, compatibility, testing, risk, frontend architecture, and compliance contracts.
- Added an explicit MVP boundary, performance/cache/query contract, custom-write mutation guards, and security/encoding criteria during adversarial checklist review.

### Review — 2026-08-25

- **Reviewer**: Agent (self-review plus fresh-context scope reviewer)
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed — no cache introduced; indexed scoped reads and immediate DB visibility documented
- **Commands**: Passed — user CRUD remains command-based; authoritative provider sync exception and rollback semantics are explicit
- **Risks**: Passed
- **Scope cohesion**: Passed — fresh-context verdict `COHESIVE`; selector, provider, provenance, REST, and UI form one deployable vertical capability
- **Verdict**: Approved

### 2026-08-25 (skeleton)

- Created initial problem statement and decision gate from TraceCore issue #866.

### Implementation — 2026-08-26

- Implemented FR-1 through FR-5 in `@open-mercato/core` with additive provider,
  lookup, provenance, REST, OpenAPI, UI, locale, migration, and upgrade-note changes.
- Added deterministic unit, route, component, and Playwright coverage, including
  `TC-CUR-015-nbp-average-rate-contract`; it seeds provenance locally and never calls NBP.
- Generated `Migration20260826143024_currencies` for nullable
  `exchange_rates.external_reference` and reviewed the scoped snapshot update.
