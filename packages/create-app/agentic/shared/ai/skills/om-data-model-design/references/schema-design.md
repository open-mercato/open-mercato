# Schema Design

Load this reference for entity shape and relationship decisions.

- Put entities in one `data/entities.ts`; use legacy decorators and explicit DB column names.
- Prefer UUID primary keys and module-prefixed plural table/index names.
- Tenant-owned rows require tenant/org IDs and an index beginning with the fields used by common scoped queries.
- Editable rows require create/update timestamps and `updated_at`; append-only logs and pure junction rows may be exempt when justified. Declare them with a property initializer (`createdAt: Date = new Date()`), not definite assignment (`createdAt!: Date`): the initializer is what keeps the column optional in the data type `createOrmEntity` derives. The same holds for every other non-nullable column with a fixed default (counters, status enums); declared with `!` they become required in each create payload, so callers end up passing values the entity already owns.
- Represent money through the Money Contract at the end of this reference; represent timestamps/timezones explicitly.
- Make nullable/optional/default semantics deliberate. A clearable field accepts explicit null through validator and command.
- Same-module relations may use ORM relations with owned/inverse sides defined. Cross-module records use scalar IDs, snapshots, events/enrichers, or `data/extensions.ts`.
- Add scoped uniqueness and partial indexes for soft-deleted data where needed. With legacy decorators, import `Unique` from `@mikro-orm/decorators/legacy` and declare a composite constraint as `@Unique({ name, properties: [...] })`; `@Index({ unique: true })` is not a supported unique-constraint shape. Ensure retries cannot create duplicates.

Canonical example source: [`data/entities.ts`](../../../../src/modules/example/data/entities.ts) (UUID PKs, snake_case columns, `tenant_id`/`organization_id`, `created_at`/`updated_at`/`deleted_at`, no cross-module relations), [`data/validators.ts`](../../../../src/modules/example/data/validators.ts) (Zod create/update/list schemas with `z.infer` types), and [`ce.ts`](../../../../src/modules/example/ce.ts) (custom entities and field kinds). The example does not implement `data/extensions.ts`; route that to `om-system-extension`.

Use generated entity IDs rather than class-name guesses in APIs/search/widgets. App-owned modules import them from `@/.mercato/generated/entities.ids.generated`; `#generated/entities.ids.generated` is a package-internal alias and must not be copied into a standalone app. Typecheck cannot detect a valid-looking but wrong entity ID string, so also start the generated route and smoke-test the affected API against its runtime registry.

## Money Contract

Every new monetary value (an amount tied to a currency) MUST use the Money shape for its layer: `Money` in domain code (service signatures, command internals, calculations), `MoneyInput` in validated request/response payloads (validators, API fields), `MoneySnapshot` in trusted messages (queues, caches, events, JSON state), and `MoneyColumns` in persisted entity fields. Code that only touches existing installed `number` + `<field>Exact` money fields keeps that contract.

- Use `Money`/`Currency` and the free functions (`createMoney`, `addMoney`, `sumMoney`, `multiplyMoney`, `divideMoney`, `allocateMoney`, `convertMoney`, `rescaleMoney`, `compareMoney`) from `@open-mercato/shared/lib/money`. Never add a new `number` or bare decimal-string money field, and never add a new `<field>Exact` pair.
- Persist through the `MoneyColumns` embeddable from `@open-mercato/shared/lib/db/moneyColumns`: `@Embedded(() => MoneyColumns, { prefix: 'total_' }) total!: MoneyColumns` yields `total_amount numeric`, `total_currency_code text`, `total_currency_decimal_places int`. Entities never hold `Money`; commands/services convert with `moneyToColumns` / `moneyFromColumns`.
- A `Currency` comes only from `await resolveCurrency(container, { code, tenantId, organizationId })` with trusted scope. It reads the installed `currencies` module, has no ISO fallback, and throws `CurrencyNotResolvedError` (also for an inactive currency or a missing tenant/organization).
- Cross-currency arithmetic throws `CurrencyMismatchError` (equal = same code and decimal places); never hide it in a `try`/`catch`. Rounding is never implicit: `divideMoney`, `convertMoney`, `rescaleMoney`, `roundMoney` take `{ decimalPlaces, mode }` (`down`/`halfUp`/`halfEven`/`up`); `allocateMoney` takes `{ decimalPlaces }`.
- Client input: `moneyInputSchema` (the amount must be a decimal string; JSON numbers are rejected) + `resolveMoney(container, scope, input)`; amounts stay exact, so a field that must be in minor units rejects `!fitsCurrencyPrecision(money)` with a 400. Queues/caches/events/JSON state: `snapshotMoney` + `restoreMoney`; never pass request input to `restoreMoney`.
- If the installed `@open-mercato/shared` lacks `lib/money`, stop and report the version skew instead of inventing a money shape.
