# Money and Currency Value Objects

## 📝 TLDR

Add two immutable value objects to `@open-mercato/shared`. `Currency` holds an ISO 4217 code, the tenant's decimal places and an optional display symbol. `Money` holds an exact decimal from `@open-mercato/shared/lib/decimal` (`big.js`) plus a `Currency`. Both are frozen, branded plain objects, and all operations are free functions shaped for `map`/`reduce`. Arithmetic on two values with different currencies throws. A `Currency` comes only from an async factory that reads `currencyPrecisionService`. Rounding is never implicit: every operation that can produce more digits than its inputs takes the caller's rounding rule.

These are for **new code only**. Migrating existing modules, entities, commands or API payloads is out of scope.

**Depends on** [Arbitrary-Precision Money and FX Rates](2026-10-08-arbitrary-precision-money-and-fx.md) (PR #7324, not yet merged). That PR supplies the decimal toolkit, `ExactDecimalType`, the ISO 4217 minor-unit table and `currencyPrecisionService`. This spec cannot be implemented before #7324 merges.

## 📝 Overview

Since PR #7324, money is an exact decimal string with a currency code stored next to it, and its precision is looked up through `currencyPrecisionService`. That is correct for the existing modules, which keep their `number` plus `<field>Exact` contracts. New code needs a single type that carries an amount and its currency together and refuses to mix currencies.

## 📝 Problem Statement

1. **Nothing pairs an amount with its currency.** New code passes `(amountExact, currencyCode, decimalPlaces)` triples through every signature. Nothing stops a USD amount from being added to a EUR amount.
2. **Precision is re-resolved at each call site.** Each caller decides on its own whether to use the tenant's decimal places, the ISO table, or `max(4, dp)`.
3. **Rounding is implicit and inconsistent.** The parent spec rounds half-up to `max(4, dp)` in sales and to the currency's own decimal places in staff. A new feature has no shared way to say "half-even to minor units" or "round down to 2 places".
4. **Splitting an amount loses cents.** Each installment or allocation feature writes its own remainder handling.

## 📝 Proposed Solution

### Resolved decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Frozen, branded plain objects with free functions (`addMoney(a, b)`), not classes | Matches `decimal.ts` and the root `AGENTS.md` preference for data-first utilities. `addMoney` is directly a `reduce` callback, and `(m) => multiplyMoney(m, qty)` is directly a `map` callback |
| D2 | A `Currency` is created **only** by `resolveCurrency(container, lookup)`, which reads `currencyPrecisionService`. No ISO fallback: if the service is absent or returns `null`, the call throws `CurrencyNotResolvedError` | Precision belongs to the tenant. A silent ISO fallback would let two code paths disagree about the same currency (D3) |
| D3 | Currencies are equal when `code` **and** `decimalPlaces` match. `symbol` is ignored. Arithmetic across unequal currencies throws `CurrencyMismatchError` | ISO JPY (0) and a tenant's JPY (2) are different units of account |
| D4 | `Money.amount` is exact at any scale. Nothing rounds implicitly. `divideMoney`, `convertMoney` and `roundMoney` require a `MoneyRounding` (`{ decimalPlaces, mode }`), and `allocateMoney` requires `decimalPlaces` | The caller decides the rounding behaviour. Intermediate values (unit price × quantity) keep every digit, as in the parent spec |
| D5 | v1 operations: add, subtract, sum, multiply, divide, negate, abs, round, allocate, convert, rescale, compare, min/max and sign checks | The full set the user asked for. FX conversion takes an explicit rate and does no rate lookup |
| D6 | Serialization: `serializeMoney` → `{ amount: string, currencyCode: string }` and a zod `moneyInputSchema`. Persistence: a `MoneyColumns` MikroORM embeddable that snapshots `amount`, `currency_code` and `currency_decimal_places` | MikroORM hydrates synchronously and cannot call the async factory. The precision snapshot makes hydration synchronous and records the precision the amount was written under |
| D7 | `Currency.symbol` is an optional display symbol (`$`). The resolver contract gains an optional `getCurrency(lookup)` that returns code, decimal places and symbol in one read | Additive. A resolver that only implements `getDecimalPlaces` still works and yields `symbol: null` |
| D8 | Lives in `packages/shared/src/lib/money/`, with the embeddable in `packages/shared/src/lib/db/moneyColumns.ts` | Same layer as `decimal.ts` and `ExactDecimalType`. No module depends on another module |

### Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Classes with methods (`price.add(tax)`) | Method chains read well, but they go against the repo's data-first rule, and unbound methods are awkward as `map`/`reduce` callbacks |
| Integer minor units with a scale (Dinero.js, moneyphp) | Every currency would need a fixed scale. The parent spec deliberately keeps intermediate amounts above minor-unit precision |
| A synchronous `Currency` built from the ISO table | Contradicts tenant-owned precision. It is also how ISO JPY and tenant JPY would get mixed silently |
| MikroORM custom `Type` mapping to `{ amount, currencyCode }` with async hydration | Entities could not hold a `Money`. Every read would need a container and an `await` |
| A single `jsonb` money column | Not queryable or sortable as a number, and it breaks with the `numeric` money columns from the parent spec |

### Market check

- **Dinero.js v2** is functional (`add(d1, d2)`, `allocate`, `convert`, `toSnapshot`), which supports D1. It stores integer amounts with a scale. We keep `big.js` exact decimals instead (see Alternatives). Its `toSnapshot` corresponds to our `MoneyColumns` snapshot.
- **moneyphp/money** throws on cross-currency arithmetic, gets currencies from a pluggable `Currencies` repository (ISO, Bitcoin, aggregate), and allocates with the largest-remainder method. `resolveCurrency` over `currencyPrecisionService` plays the repository role, and D3 and `allocateMoney` follow the same rules.
- **JSR 354 (Java Money)** keeps rounding as a separate, caller-chosen `MonetaryRounding` instead of baking it into arithmetic. D4 does the same.
- **What we skip:** formatting and locale display (`formatCurrency` stays the display path), and currency-unit registries independent of tenants.

### Out of scope

- Migrating existing entities, commands, calculators, API payloads or UI to `Money`/`Currency`.
- Changing any `number` / `<field>Exact` contract from PR #7324.
- Looking up exchange rates. `convertMoney` takes the rate from its caller (for example `exchangeRateService`).
- Formatting.

## 📝 Architecture

### Types (`packages/shared/src/lib/money/types.ts`)

```ts
declare const currencyBrand: unique symbol
declare const moneyBrand: unique symbol

export type Currency = Readonly<{
  code: string
  decimalPlaces: number
  symbol: string | null
}> & { readonly [currencyBrand]: true }

export type Money = Readonly<{
  amount: DecimalValue
  currency: Currency
}> & { readonly [moneyBrand]: true }

export type MoneyRoundingMode = 'down' | 'halfUp' | 'halfEven' | 'up'

export type MoneyRounding = Readonly<{ decimalPlaces: number; mode: MoneyRoundingMode }>
```

- Brands are type-only. An object literal does not type-check as a `Money`, so values come from the functions below.
- Every `Currency`, `Money` and `Money.amount` is `Object.freeze`d. Freezing the `big.js` instance makes in-place mutation of `c`/`e`/`s` throw in strict mode. `big.js` methods already return new instances.
- `MoneyRoundingMode` maps to `big.js` rounding modes 0, 1, 2 and 3. `down` and `up` mean toward and away from zero.
- `decimalPlaces` must be an integer from 0 to 50, matching the parent spec's validator cap. Anything else throws.

### Currency factory (`currency.ts`)

```ts
resolveCurrency(container, { code, tenantId, organizationId }): Promise<Currency>
currenciesEqual(left: Currency, right: Currency): boolean
assertSameCurrency(left: Currency, right: Currency): void
```

- The factory normalizes `code` (`trim().toUpperCase()`) and requires it to match `^[A-Z]{3}$`, the same rule as the currencies validator. It resolves `currencyPrecisionService` softly, like `resolveCurrencyDecimalPlaces` does.
- It calls `getCurrency(lookup)` when the resolver has it. Otherwise it calls `getDecimalPlaces(lookup)` and sets `symbol: null`.
- It throws `CurrencyNotResolvedError` when the service is not registered, returns `null` (unknown code, no organization) or itself throws. In the last case the original error is kept as `cause`.
- It does **not** fall back to ISO (D2). This is a deliberate split from `resolveCurrencyDecimalPlaces`, which falls back to ISO and stays the precision path for the existing `<field>Exact` code. The rule: code that holds a `Money` gets its currency from `resolveCurrency`, and existing code keeps using `resolveCurrencyDecimalPlaces`. Neither path calls the other.

### Money functions (`money.ts`)

| Function | Rule |
|----------|------|
| `createMoney(amount: DecimalInput, currency)` | `toDecimal` validation and the parent spec's size caps apply. The amount is exact, with no rounding |
| `zeroMoney(currency)` | Starting value for a `reduce` |
| `addMoney(a, b)`, `subtractMoney(a, b)` | `assertSameCurrency`, then exact |
| `sumMoney(currency, values)` | `values.reduce(addMoney, zeroMoney(currency))`. The currency is required so an empty list is well defined |
| `multiplyMoney(m, factor: DecimalInput)` | Exact |
| `divideMoney(m, divisor, rounding)` | One `big.js` division on a module-private constructor (`const RoundedDivision = BigConstructor()`). The function sets `RoundedDivision.DP` and `RoundedDivision.RM` from `rounding` inside `try`/`finally`, then runs `new RoundedDivision(m.amount.toFixed()).div(divisor)`; `div` reads `DP`/`RM` from the dividend's constructor. The quotient is rounded **once**, with no cut at 50 places followed by a second rounding. The result is re-wrapped with `toDecimal(quotient.toFixed())`, so every `Money.amount` comes from the shared constructor. Division by zero throws |
| `roundMoney(m, rounding)` | `amount.round(dp, mode)` |
| `negateMoney`, `absMoney` | Exact |
| `allocateMoney(m, ratios, { decimalPlaces })` | Largest-remainder method; see below |
| `convertMoney(m, rate, target, rounding)` | `rate` must be positive and means target units per one source unit. The amount is `round(m.amount × rate)`, an exact multiplication followed by one rounding. A target with the same code throws `CurrencyMismatchError` |
| `rescaleMoney(m, target, rounding)` | The only way to move an amount between two currencies with the same code and different `decimalPlaces` (a tenant precision change). It throws when the codes differ |
| `compareMoney(a, b)` | Asserts the same currency, returns `-1 \| 0 \| 1`. Usable as an `Array.sort` comparator |
| `moneyEquals(a, b)` | `false` for different currencies (not arithmetic, so it does not throw) |
| `isZeroMoney`, `isNegativeMoney`, `isPositiveMoney` | |
| `minMoney(...values)`, `maxMoney(...values)` | Assert the same currency. Throw on an empty list |

**`allocateMoney` algorithm.**
1. Throw `InvalidAllocationError` when `m.amount` has more than `decimalPlaces` decimals (round it first, since rounding is explicit), when `ratios` is empty, when any ratio is negative, or when all ratios are zero.
2. Make the ratios integers by scaling them all by `10^k`, where `k` is the largest number of decimals among them. Let `U = |amount| × 10^decimalPlaces` (an integer number of units) and `S = Σratios`.
3. Share `i` gets `floor(U × ratio_i / S)` units, computed with exact integer math (`big.js` `div` at `DP = 0`, `RM = down`, on integers).
4. The leftover `U − Σshares` units (an integer smaller than the number of ratios) go one each to the shares with the largest **exact** remainder `(U × ratio_i) mod S`. Ties go to the lower index. A zero ratio has remainder 0 and never receives a unit.
5. Convert the units back (`× 10^-decimalPlaces`) and restore the sign.

The result always sums exactly to `m`, and the order is decided only by exact integer remainders.

### Errors (`errors.ts`)

`CurrencyMismatchError` (carries `left` and `right` currencies), `CurrencyNotResolvedError` (carries `code` and `cause`), `InvalidAllocationError`, and `InvalidMoneyRoundingError`. All extend `Error`. Messages start with `[internal]` because they signal programmer errors and are not shown to users. A route that wants a 400 maps them explicitly.

### Serialization (`serialization.ts`)

- `serializeMoney(m)` → `{ amount: decimalToString(m.amount), currencyCode: m.currency.code }`. Precision and symbol are not serialized. A client gets them from `/api/currencies/currencies`.
- `moneyInputSchema` (zod) → `{ amount: decimalStringSchema, currencyCode: <3-letter code> }`. Its output is a plain `MoneyInput`, **not** a `Money`.
- `resolveMoney(container, scope, input)` → `Promise<Money>` runs `resolveCurrency` and then `createMoney`. Request input always reaches a `Money` through this async path.

### Persistence (`packages/shared/src/lib/db/moneyColumns.ts`)

```ts
@Embeddable()
export class MoneyColumns {
  @Property({ type: ExactDecimalType, columnType: 'numeric' }) amount!: string
  @Property({ name: 'currency_code', type: 'text' }) currencyCode!: string
  @Property({ name: 'currency_decimal_places', type: 'integer' }) currencyDecimalPlaces!: number
}
export function moneyToColumns(m: Money): MoneyColumns
export function moneyFromColumns(columns: MoneyColumns): Money
```

- A new entity declares `@Embedded(() => MoneyColumns, { prefix: 'price_', nullable? })`. That produces `price_amount`, `price_currency_code` and `price_currency_decimal_places`.
- `moneyFromColumns` re-validates the snapshot with the same rules as the factory: the code must match `^[A-Z]{3}$`, `decimalPlaces` must be an integer from 0 to 50, and the amount must pass `toDecimal`. Otherwise it throws. For a nullable embedded field, MikroORM leaves the property `null`, so adopters call `columns ? moneyFromColumns(columns) : null`. A partially null snapshot throws.
- `moneyFromColumns` is the **one** synchronous path that creates a `Currency`. It restores a snapshot taken by `moneyToColumns`, which itself came from a resolved currency. The symbol is not stored, so the restored value has `symbol: null`. That is harmless because `symbol` does not affect equality (D3).
- Entities hold `MoneyColumns`, not `Money`. MikroORM hydrates mutable embeddable instances, so conversion happens at the command or service boundary.

### Resolver contract extension (`packages/shared/src/lib/currencyPrecision.ts`)

```ts
export type CurrencyDetails = { code: string; decimalPlaces: number; symbol: string | null }
export type CurrencyPrecisionResolver = {
  getDecimalPlaces(lookup: CurrencyPrecisionLookup): Promise<number | null>
  getCurrency?(lookup: CurrencyPrecisionLookup): Promise<CurrencyDetails | null>
}
```

`CurrencyPrecisionService` (currencies module) implements `getCurrency`. The per-request lookup cache changes from a decimal-places promise to a `CurrencyDetails` promise, and `getDecimalPlaces` reads from it. The query is unchanged: `findOneWithDecryption`, scoped to the tenant and organization, `deletedAt: null`, and `null` without an organization.

## 📝 Data Models

No existing tables change, and there is no migration. `MoneyColumns` is a reusable embeddable for **new** entities. Each adopter generates its own migration with three columns per money field: `numeric`, `text` and `integer`. Money stays non-sensitive, so no encryption is involved.

## 📝 API Contracts

No HTTP endpoints are added or changed, so this spec needs no integration (Playwright) coverage: no API or UI path is touched. The contract surfaces involved:

| Surface | Change | BC class |
|---------|--------|----------|
| Import paths `@open-mercato/shared/lib/money/*`, `@open-mercato/shared/lib/db/moneyColumns` | New | Additive |
| `CurrencyPrecisionResolver` type | New optional `getCurrency` method, new `CurrencyDetails` type | Additive. Existing implementers and test doubles still compile |
| DI key `currencyPrecisionService` | Unchanged key; the service gains a method | Additive |

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| No organization in the lookup (CLI, system jobs) | The service returns `null`, so `CurrencyNotResolvedError`. Callers must pass the organization |
| Currencies module disabled | `currencyPrecisionService` is not registered, so `CurrencyNotResolvedError` |
| Currency soft-deleted after a `Money` was persisted | `moneyFromColumns` still restores it from the snapshot. A new `resolveCurrency` throws |
| Tenant changes `decimal_places` (2 → 4) | Restored values carry dp 2 and freshly resolved ones carry dp 4. Mixing them throws `CurrencyMismatchError`. This is a known cost of D3, which the user accepted: a config change surfaces as an error, not as silent mixing. An adopter that reads stored money next to freshly resolved money calls `rescaleMoney(old, fresh, rounding)` at its read boundary. Going from fewer to more decimals is lossless; going from more to fewer follows the caller's rounding |
| `Money` passed through a queue, cache or `structuredClone` | The brand and the `Big` prototype are lost. Callers must send `serializeMoney` and call `resolveMoney` (or store `MoneyColumns`) on the other side |
| Two copies of `big.js` in a bundle | `toDecimal` accepts `Big` from the shared constructor only. `createMoney` takes strings at module boundaries |
| `divideMoney` by a value with a non-terminating quotient (`1/3`) | Rounded once to the caller's rounding. No hidden 50-place cut |
| `allocateMoney` on an amount with more decimals than `decimalPlaces` | `InvalidAllocationError`. The caller rounds first |
| Negative amounts in `allocateMoney` | The split runs on the absolute value and every share is non-positive, so the parts still sum to the total |
| Stale local install resolves `big.js` 5.x (the lockfile pins 7.0.1) | Mode `up` (RM 3) does not exist before v6. The rounding-mode tests cover `up`, so a stale install fails loudly. Run `yarn install` |
| Oversized input (`1e5000`) | Rejected by `toDecimal` caps, as in the parent spec |

## 📝 Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|------|----------|------|------------|----------|
| `@Embeddable` defined in `shared` is not picked up by the module entity discovery or `yarn db:generate` | Medium | ORM | Phase 2 Step 1 proves discovery with a metadata-only test (`connect: false`). If discovery fails, the fallback is to re-export `MoneyColumns` from the adopter's `data/entities.ts`, documented in `packages/shared/AGENTS.md` | Low |
| Snapshot precision drifts from the tenant setting | Low | Data | Mixing throws (D3) instead of computing silently. A documented `rescaleMoney` path | Low |
| Adopters bypass `resolveCurrency` by forging a `MoneyColumns` | Low | API misuse | `moneyFromColumns` validates the code and `decimalPlaces`. The AGENTS.md rule says it is for entity hydration only | Low |
| PR #7324 changes the decimal toolkit or the resolver type before merging | Medium | Dependency | The draft PR stays draft until #7324 merges, then rebases and re-checks D2/D7 against the merged API | Low |
| Two money styles coexist (`<field>Exact` vs `Money`) | Low | DX | The `shared` AGENTS.md row states that `Money` is for new code and that existing contracts stay untouched | Accepted |

Rollback: the change is purely additive with no data migration, so it is reverted by reverting the PR. The optional resolver method can be removed only if no adopter calls `resolveCurrency` with symbols.

## 📋 Phasing

- **Phase 1 — Value objects.** Types, `resolveCurrency` with the resolver extension, the Money functions, errors and serialization. Shippable alone.
- **Phase 2 — Persistence.** The `MoneyColumns` embeddable and its conversions, plus the documentation rows.

## 📋 Implementation Plan

### Phase 1 — Value objects

1. Add `CurrencyDetails` and the optional `getCurrency` to `currencyPrecision.ts`. Implement it in `CurrencyPrecisionService` on a shared per-request cache. Extend `currencyPrecisionService.test.ts` to cover the symbol, `null` without an organization, and one query for both methods.
2. Add `lib/money/types.ts`, `errors.ts` and `currency.ts` (`resolveCurrency`, `currenciesEqual`, `assertSameCurrency`). Unit tests: `getCurrency` path, `getDecimalPlaces`-only path, missing service, `null`, a resolver that throws (with `cause`), invalid code, invalid `decimalPlaces`, frozen result.
3. Add `money.ts`: create, zero, add, subtract, sum, multiply, negate, abs, compare, equals, min/max and sign checks. Unit tests: exactness (`0.1 + 0.2`), cross-currency throws (different code, and same code with different dp), `reduce`/`sort` usage, immutability (mutating a frozen value throws).
4. Add `divideMoney`, `roundMoney`, `convertMoney` and `rescaleMoney` with `MoneyRounding`. Unit tests:
   - every rounding mode, with positive and negative halves;
   - single rounding: a quotient of `0.00499…9` (60 nines) rounded half-up to 2 places must be `0.00`, where a 50-place cut followed by a second rounding would give `0.01`;
   - the shared `Decimal.DP` is unchanged after a call, including one that throws;
   - division by zero, a non-positive rate, `convertMoney` to a same-code target throws, `rescaleMoney` across codes throws.
5. Add `allocateMoney`. Tests:
   - property-style: the parts always sum to the total;
   - tie-breaking by exact remainder: `0.10` split `[1, 1, 1]` gives `[0.04, 0.03, 0.03]`;
   - decimal ratios (`[0.5, 0.25, 0.25]`), negative totals, zero ratios, invalid inputs.
6. Add `serialization.ts` (`serializeMoney`, `moneyInputSchema`, `resolveMoney`) with round-trip tests. Add the `decimal.ts`-adjacent row to `packages/shared/AGENTS.md`.

### Phase 2 — Persistence

1. Add `lib/db/moneyColumns.ts` (`MoneyColumns`, `moneyToColumns`, `moneyFromColumns`). Add a MikroORM metadata test with `connect: false` and a test-only entity, asserting the prefixed column names and types, and conversion round-trip tests.
2. Document the adopter recipe (embed, prefix, migration, command-boundary conversion) in `packages/shared/AGENTS.md` and in `apps/docs` under the data-integrity docs.

Validation per step: `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/core test` for Step 1.1, then `yarn typecheck` and `yarn lint`.

## 📝 Final Compliance Report

- Tenant scoping: the currency lookup reuses the scoped `findOneWithDecryption` query, and there is no cross-tenant path.
- No direct ORM relations between modules. `shared` does not import `core`, and the currencies module implements a shared contract.
- No user-facing strings: all errors are `[internal]`.
- BC: additive surfaces only (see API Contracts).
- No `any`. Input types are derived from zod (`MoneyInput = z.infer<typeof moneyInputSchema>`).
- No new dependency: `big.js` arrives with PR #7324.
- Ask-first surfaces: the new public types in `@open-mercato/shared` and the additive `CurrencyPrecisionResolver.getCurrency` method were requested by the maintainer driving this spec (Q6 and Q7, 2026-10-22). Reviewers confirm both in the draft PR.
- Scope: a reviewer suggested splitting `getCurrency`/`symbol` and persistence into separate specs. The user chose to keep them in one spec. They ship as separate phases, and Phase 2 can be deferred without affecting Phase 1.

## 📝 Changelog

- 2026-10-22 — Initial draft.
