# Money and Currency Value Objects

## 📝 TLDR

Add two immutable value objects to `@open-mercato/shared`. `Currency` holds an ISO 4217 code, the tenant's decimal places and an optional display symbol. `Money` holds an exact decimal from `@open-mercato/shared/lib/decimal` (`big.js`) plus a `Currency`. Both are frozen, branded plain objects, and all operations are free functions shaped for `map`/`reduce`. Arithmetic on two values with different currencies throws. A `Currency` comes only from an async factory that reads `currencyPrecisionService`. Rounding is never implicit: every operation that can produce more digits than its inputs takes the caller's rounding rule.

These are for **new code only**. Migrating existing modules, entities, commands or API payloads is out of scope. Once these objects ship, the project harness (agent instructions, review checklist, standalone-app harness and an advisory diff check) is updated so that every **new** monetary value must use them.

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
| D6 | Two wire shapes. An untrusted `MoneyInput` (`{ amount, currencyCode }`, zod `moneyInputSchema`, resolved async against the tenant's current precision). A trusted `MoneySnapshot` (`{ amount, currencyCode, currencyDecimalPlaces }`, restored synchronously) for queues, caches and events. Persistence: a `MoneyColumns` MikroORM embeddable with the `MoneySnapshot` shape | Precision is part of a currency's identity (D3), so anything the system wrote must come back at the precision it was written with. MikroORM hydrates synchronously and cannot call the async factory. Only client input is re-resolved |
| D7 | `Currency.symbol` is an optional display symbol (`$`). The resolver contract gains an optional `getCurrency(lookup)` that returns code, decimal places and symbol in one read | Additive. A resolver that only implements `getDecimalPlaces` still works and yields `symbol: null` |
| D8 | Lives in `packages/shared/src/lib/money/`, with the embeddable in `packages/shared/src/lib/db/moneyColumns.ts` | Same layer as `decimal.ts` and `ExactDecimalType`. No module depends on another module |
| D9 | The project harness enforces `Money` for **all new code** that handles monetary values: agent instructions, the review checklist, the standalone-app harness and an advisory diff check | A value object that is optional in practice gets skipped. "New code only" must mean "new code always", or a third money style piles up next to `number` and `<field>Exact` |

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
- **Deep immutability.** A `big.js` value keeps its digits in a coefficient array (`c`). Freezing only the instance leaves that array writable: on big.js 7.0.1 in strict mode, `Object.freeze(new Big('12.34')).c[0] = 9` silently turns the value into `92.34`. So the rules are:
  - **Ownership:** every function that stores an amount makes its own copy first (`new Decimal(value)`, where `big.js` copies the array with `c.slice()`). A `Big` the caller still holds is never stored by reference.
  - **Deep freeze:** `freezeDecimal(value)` freezes `value.c` and then `value`. Every `Money.amount` goes through it, and so do `Money` and `Currency` themselves.
  - **Non-mutating operations only:** with deep-frozen operands, `plus`, `minus`, `times`, `div`, `round`, `abs`, `neg`, `cmp`, `eq` and `toFixed` work and return new instances (verified on 7.0.1). `mod` does not: it writes to its operands' sign field and throws on a frozen value. It may only be called on fresh copies, as in `allocateMoney` step 4.
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
4. The leftover `U − Σshares` units (an integer smaller than the number of ratios) go one each to the shares with the largest **exact** remainder `(U × ratio_i) mod S`, computed on the fresh product, never on a stored amount. Ties go to the lower index. A zero ratio has remainder 0 and never receives a unit.
5. Convert the units back (`× 10^-decimalPlaces`) and restore the sign.

The result always sums exactly to `m`, and the order is decided only by exact integer remainders.

### Errors (`errors.ts`)

`CurrencyMismatchError` (carries `left` and `right` currencies), `CurrencyNotResolvedError` (carries `code` and `cause`), `InvalidAllocationError`, and `InvalidMoneyRoundingError`. All extend `Error`. Messages start with `[internal]` because they signal programmer errors and are not shown to users. A route that wants a 400 maps them explicitly.

### Serialization (`serialization.ts`)

Money moves in two shapes. They differ in **who** produced them, not in **where** they travel.

| Shape | Produced by | Carries | Read back with |
|-------|-------------|---------|----------------|
| `MoneyInput` (**untrusted**) | Clients: request bodies, imports, webhooks | `{ amount, currencyCode }` | `resolveMoney(container, scope, input)`, async, using the tenant's **current** precision |
| `MoneySnapshot` (**trusted**, internal) | This system: `snapshotMoney(m)` | `{ amount, currencyCode, currencyDecimalPlaces }` | `restoreMoney(snapshot)`, sync, keeping the precision **at the time of the snapshot** |

- `serializeMoney(m)` → `MoneyInput`, for API responses. Precision and symbol are left out; a client gets them from `/api/currencies/currencies`.
- `moneyInputSchema` (zod) parses request input into a plain `MoneyInput`, **not** a `Money`. Request input always reaches a `Money` through `resolveMoney`.
- `snapshotMoney(m)` → `MoneySnapshot`, and `moneySnapshotSchema` (zod) validates one. Queues, caches, events, workflow state and persisted JSON all carry a `MoneySnapshot`, never a `MoneyInput`. Precision is part of a currency's identity (D3), so a value sent before a precision change must keep its old precision when it arrives, and mixing it with fresh money must still throw until the receiver calls `rescaleMoney`. A soft-deleted or disabled currency does not stop a snapshot from being restored.
- `restoreMoney(snapshot)` validates with the same rules as the factory: the code must match `^[A-Z]{3}$`, `currencyDecimalPlaces` must be an integer from 0 to 50, and the amount must pass `toDecimal`. Otherwise it throws. It runs no tenant lookup, which is why it must never receive request input. A request field that claims a precision is a `MoneyInput` with an extra key, and `moneyInputSchema` strips it.

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
- `MoneyColumns` has the `MoneySnapshot` shape. `moneyToColumns` is `snapshotMoney`, and `moneyFromColumns` delegates to `restoreMoney`, so the database and the transport paths share one validation. For a nullable embedded field, MikroORM leaves the property `null`, so adopters call `columns ? moneyFromColumns(columns) : null`. A partially null snapshot throws.
- `restoreMoney` (and through it `moneyFromColumns`) is the **only** synchronous path that creates a `Currency`. It restores a snapshot taken from a resolved currency. The symbol is not part of a snapshot, so the restored value has `symbol: null`. That is harmless because `symbol` does not affect equality (D3).
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

### Harness enforcement (D9)

Once Phases 1–2 ship, the project harness must make `Money` the required representation for monetary values in new code. Existing code and its `number` / `<field>Exact` contracts are exempt, because migration is out of scope.

**What counts as new code:** a monetary value (an amount tied to a currency) introduced in a PR. That covers:
- a new entity column, or a new embedded field;
- a new validator field, command input or service signature;
- a new API request or response field.

Code that only touches existing money fields does not count.

| Surface | Update |
|---------|--------|
| Root `AGENTS.md` | One `Always` line: new monetary values use `Money`/`Currency` from `@open-mercato/shared/lib/money` and persist through `MoneyColumns`. One `Never` line: no new `number` or bare decimal-string money fields, and no new `<field>Exact` pairs. Plus a Task Router row pointing to the shared guide. It must stay within the 32 KB budget (`yarn agents:check-budget`) |
| `packages/shared/AGENTS.md` | The `lib/money` row (when to use it, the import path, rounding is explicit, `resolveCurrency` only) and the adopter recipe from Phase 2. The `decimal.ts` row says that raw decimal math is for existing `<field>Exact` code and for non-monetary FX math |
| `.ai/review-checklist.md` (used by `om-code-review` / `om-auto-review-pr`) | Checklist items: new monetary fields use `Money` and `MoneyColumns`; currencies come from `resolveCurrency`; every division, conversion or allocation passes an explicit rounding; a cross-currency operation is not hidden by a `try`/`catch` |
| Spec-writing guidance (`.ai/specs/AGENTS.md`, the `om-spec-writing` review lens via the repo-local override) | A spec that adds monetary fields states that they use `Money` and lists their `MoneyColumns` |
| Standalone-app harness (`packages/create-app/agentic/`, refreshed through `om-refresh-standalone-harness`) | The same rule in the generated app's agent instructions and review checklist, so third-party modules get it too. Add a `cases.json` case that checks the guidance is routed |
| Advisory diff check (`scripts/money-check-new-code.mjs`, `yarn money:check-new-code`) | Flags added lines in a diff that declare new `numeric` money-like columns (`*_amount`, `*_price*`, `*_total*`, `*_cost`, `*_value`, `*_fee`) or new `<field>Exact` keys outside `MoneyColumns`. It is advisory at first, like `i18n:check-hardcoded`, and reads an allowlist (`.ai/money-allowlist.json`) for intentional exceptions such as extending an existing `<field>Exact` contract |

The check is a heuristic. The review checklist and the agent instructions are the actual enforcement. The check only spots likely misses for the reviewer.

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
| `Money` passed through a queue, cache or `structuredClone` | The brand and the `Big` prototype are lost. Senders send `snapshotMoney(m)`, and receivers call `restoreMoney`. The receiver gets the precision the sender used, not the current tenant setting |
| Precision changes (dp 2 → 4) while a snapshot is in a queue | Received with dp 2. Mixing it with freshly resolved money throws `CurrencyMismatchError` until the receiver calls `rescaleMoney`, the same as a stored `MoneyColumns` |
| Currency soft-deleted or disabled while a snapshot is in a queue | `restoreMoney` still succeeds, since it runs no lookup. A new `resolveCurrency` for that code throws |
| A client sends `currencyDecimalPlaces` in a request body | `moneyInputSchema` strips it. A request never reaches `restoreMoney` |
| Caller mutates a `Big` after passing it to `createMoney` | The `Money` is unaffected, because it owns a copy |
| Code writes `m.amount.c[0] = 9` | Throws a `TypeError` in strict mode, because the coefficient array is frozen |
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
| Adopters bypass `resolveCurrency` by passing request input to `restoreMoney` or by forging `MoneyColumns` | Medium | API misuse | `restoreMoney` validates the code, dp and amount. `moneyInputSchema` strips precision from requests. The Phase 3 review-checklist item: `restoreMoney` only reads snapshots the system wrote itself | Low |
| PR #7324 changes the decimal toolkit or the resolver type before merging | Medium | Dependency | The draft PR stays draft until #7324 merges, then rebases and re-checks D2/D7 against the merged API | Low |
| Two money styles coexist (`<field>Exact` vs `Money`) | Low | DX | The `shared` AGENTS.md row states that `Money` is for new code and that existing contracts stay untouched. Phase 3 enforces it for new code | Accepted |
| The advisory check gives false positives (a non-money `*_value` column) or misses (a money field with an unusual name) | Low | Harness | It stays advisory with an allowlist. The review checklist is the binding gate | Low |
| The new `AGENTS.md` lines push the root file past the 32 KB budget | Low | Harness | Keep the root to two lines plus a router row, and put the detail in `packages/shared/AGENTS.md` | Low |

Rollback: see Migration & Backward Compatibility below.

## 📝 Migration & Backward Compatibility

**Existing contracts.** Nothing existing changes. The `number` / `<field>Exact` fields, the `getDecimalPlaces` method, the DI key `currencyPrecisionService` and every existing table stay as they are. There is no data migration.

**New contract surfaces** (classes from `BACKWARD_COMPATIBILITY.md`):

| Surface | BC category | Class once released |
|---------|-------------|---------------------|
| `@open-mercato/shared/lib/money/*`, `@open-mercato/shared/lib/db/moneyColumns` | 4. Import Paths | STABLE |
| `Money`, `Currency`, `MoneyRounding`, `MoneyRoundingMode`, `MoneyInput`, `MoneySnapshot`, `CurrencyDetails`, the error classes | 2. Type Definitions | STABLE |
| The Money functions, `resolveCurrency`, `snapshotMoney`/`restoreMoney`, `moneyToColumns`/`moneyFromColumns` | 3. Function Signatures | STABLE |
| `CurrencyPrecisionResolver.getCurrency?` | 2. Type Definitions | STABLE, and it **MUST stay optional**, the same rule as `TelemetryProvider.reportError?`. Third-party resolvers implement this type |
| `MoneyColumns` column suffixes (`_amount`, `_currency_code`, `_currency_decimal_places`) | 8. Database Schema | ADDITIVE-ONLY. Adopter tables depend on them |

**Rollback before release.** Until a published version contains these surfaces, nothing outside the repo can depend on them. Reverting the implementation PRs is the rollback.

**Removal or change after release.** Once a version ships them, every surface above follows the deprecation protocol in `BACKWARD_COMPATIBILITY.md`, whatever the actual usage is. For example, `getCurrency` cannot be removed on the grounds that no adopter uses symbols, because any direct consumer of `CurrencyDetails` or `getCurrency` can depend on it. The protocol:
1. Never remove in the same release.
2. Mark it `@deprecated`.
3. Provide a bridge for at least one minor version, for example `getCurrency` built on `getDecimalPlaces` with `symbol: null`, or the old function re-exported from the new path.
4. Document it in `UPGRADE_NOTES.md`.
5. Reference a spec with a Migration & Backward Compatibility section.

**Wire formats.** `MoneySnapshot` is persisted in queue payloads and JSON state, so its keys are as stable as a schema: fields may be added, but never renamed or removed. A receiver MUST accept snapshots written by the previous minor version.

## 📋 Phasing

- **Phase 1 — Value objects.** Types, `resolveCurrency` with the resolver extension, the Money functions, errors and serialization. Shippable alone.
- **Phase 2 — Persistence.** The `MoneyColumns` embeddable and its conversions, plus the documentation rows.
- **Phase 3 — Harness enforcement.** Agent instructions, review checklist, standalone-app harness and the advisory diff check (D9). It ships after Phases 1–2, because the rules must point at APIs that exist.

## 📋 Implementation Plan

### Phase 1 — Value objects

1. Add `CurrencyDetails` and the optional `getCurrency` to `currencyPrecision.ts`. Implement it in `CurrencyPrecisionService` on a shared per-request cache. Extend `currencyPrecisionService.test.ts` to cover the symbol, `null` without an organization, and one query for both methods.
2. Add `lib/money/types.ts`, `errors.ts` and `currency.ts` (`resolveCurrency`, `currenciesEqual`, `assertSameCurrency`). Unit tests: `getCurrency` path, `getDecimalPlaces`-only path, missing service, `null`, a resolver that throws (with `cause`), invalid code, invalid `decimalPlaces`, frozen result.
3. Add `money.ts`: create, zero, add, subtract, sum, multiply, negate, abs, compare, equals, min/max and sign checks. Unit tests: exactness (`0.1 + 0.2`), cross-currency throws (different code, and same code with different dp), `reduce`/`sort` usage. Immutability regressions, in strict mode:
   - `m.amount.c[0] = 9`, `m.amount.s = -1`, `m.currency.decimalPlaces = 4` and `m.amount = …` each throw, and `m` is unchanged;
   - mutating the caller's own `Big` after `createMoney` leaves `m` unchanged;
   - every function in the table runs on deep-frozen inputs without throwing and leaves them unchanged, including `allocateMoney`, which uses `mod`.
4. Add `divideMoney`, `roundMoney`, `convertMoney` and `rescaleMoney` with `MoneyRounding`. Unit tests:
   - every rounding mode, with positive and negative halves;
   - single rounding: a quotient of `0.00499…9` (60 nines) rounded half-up to 2 places must be `0.00`, where a 50-place cut followed by a second rounding would give `0.01`;
   - the shared `Decimal.DP` is unchanged after a call, including one that throws;
   - division by zero, a non-positive rate, `convertMoney` to a same-code target throws, `rescaleMoney` across codes throws.
5. Add `allocateMoney`. Tests:
   - property-style: the parts always sum to the total;
   - tie-breaking by exact remainder: `0.10` split `[1, 1, 1]` gives `[0.04, 0.03, 0.03]`;
   - decimal ratios (`[0.5, 0.25, 0.25]`), negative totals, zero ratios, invalid inputs.
6. Add `serialization.ts` (`serializeMoney`, `moneyInputSchema`, `resolveMoney`, `snapshotMoney`, `moneySnapshotSchema`, `restoreMoney`). Tests:
   - round-trips for both shapes;
   - delayed receipt: snapshot JPY at dp 2, change the resolver to dp 4, then `restoreMoney` still gives dp 2, `addMoney` with a freshly resolved JPY throws, and `rescaleMoney` fixes it;
   - delayed receipt after the currency is soft-deleted (the resolver returns `null`) still restores;
   - `moneyInputSchema` strips `currencyDecimalPlaces`;
   - `restoreMoney` rejects an invalid code, dp or amount. Add the `decimal.ts`-adjacent row to `packages/shared/AGENTS.md`.

### Phase 2 — Persistence

1. Add `lib/db/moneyColumns.ts` (`MoneyColumns`, `moneyToColumns`, `moneyFromColumns`). Add a MikroORM metadata test with `connect: false` and a test-only entity, asserting the prefixed column names and types, and conversion round-trip tests.
2. Document the adopter recipe (embed, prefix, migration, command-boundary conversion) in `packages/shared/AGENTS.md` and in `apps/docs` under the data-integrity docs.

### Phase 3 — Harness enforcement

1. Update root `AGENTS.md` (`Always`/`Never` lines and a Task Router row) and `packages/shared/AGENTS.md`. Run `yarn agents:check-budget`.
2. Add the `Money` items to `.ai/review-checklist.md`, and the spec-writing rule to `.ai/specs/AGENTS.md`.
3. Add `scripts/money-check-new-code.mjs`, the `yarn money:check-new-code` script and `.ai/money-allowlist.json`. Tests: fixture diffs that must flag a new `numeric` amount column and a new `<field>Exact` key, and must not flag `MoneyColumns` or allowlisted paths.
4. Mirror the rule into the standalone-app harness with `om-refresh-standalone-harness`, add a `cases.json` routing case, and run the harness checks.

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
- 2026-10-22 — Added D9 and Phase 3: harness enforcement of `Money` for all new monetary code.
- 2026-10-23 — Review fixes:
  - `Money.amount` is now deep-frozen, and `Money` owns a copy of its amount. The shallow freeze left big.js's coefficient array writable.
  - Added a trusted `MoneySnapshot` transport (`snapshotMoney`/`restoreMoney`), separate from the untrusted `MoneyInput`, so values in queues and caches keep their precision.
  - Replaced the rollback rule with a Migration & Backward Compatibility section that follows `BACKWARD_COMPATIBILITY.md`.
