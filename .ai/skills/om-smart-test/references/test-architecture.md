# Test Architecture — Open Mercato

## Frameworks

| Framework | Purpose | Config |
|-----------|---------|--------|
| Jest + ts-jest | Unit and component tests | `jest.config.cjs` (root + 17 packages + 1 app) |
| Playwright | Integration / E2E tests | `.ai/qa/tests/playwright.config.ts` |

## File Counts (approximate)

- Unit/component tests: ~485 files (`*.test.ts`, `*.test.tsx`)
- Integration tests: ~323 files (`*.spec.ts` inside `__integration__/`)
- Total: ~808 test files

## Test File Conventions

```
packages/<pkg>/src/modules/<module>/
  __tests__/
    *.test.ts        # Jest unit tests
    *.test.tsx       # React component tests
  __integration__/
    meta.ts          # Module-level dependency declarations
    index.ts         # Sometimes used instead of meta.ts
    *.spec.ts        # Playwright integration tests
    <subfolder>/
      index.ts       # Subfolder dependency declarations (cascaded)
      *.spec.ts
      *.meta.ts      # Per-test dependency declarations (rare)
```

## Module Path Extraction

Extract module name from file path by finding `/modules/<name>/`:

| File path | Module |
|-----------|--------|
| `packages/core/src/modules/customers/lib/foo.ts` | `customers` |
| `packages/core/src/modules/sales/api/...` | `sales` |
| `apps/mercato/src/modules/pos/page.tsx` | `pos` |
| `packages/enterprise/src/modules/enterprise_pricing/...` | `enterprise_pricing` |

## Wide-Scope Triggers (→ run full suite)

These path prefixes indicate cross-cutting changes that affect all tests:

- `packages/shared/` — utilities, types, DSL helpers, i18n
- `packages/events/` — event bus
- `packages/queue/` — background workers
- `packages/cache/` — caching layer
- `jest.config.` — test runner config
- `jest.setup.` — test environment setup
- `tsconfig` — TypeScript configuration
- `package.json` (root) — deps/scripts
- `turbo.json` — monorepo build config

## Layer Classification (→ controls whether Playwright runs)

For any non-wide change, classify each modified source file into a layer to decide if integration tests are needed.

### UI layer — Jest only, **skip Playwright**

Only pure CSS / design tokens / Tailwind primitives qualify. These files cannot affect DOM structure or component interactivity.

| Pattern | Examples |
|---------|---------|
| `**/*.css` | Global stylesheets |
| `packages/ui/src/primitives/**` | Button.tsx, Badge.tsx — Radix/Tailwind primitives |
| `packages/ui/src/styles/**` | CSS variables, Tailwind config |

### UI-Component layer — Jest + **run Playwright**

React components (`.tsx`) that render into pages visited by Playwright. A broken render, a missing element, or a changed conditional can break Playwright selectors even without touching any API.

| Pattern | Examples |
|---------|---------|
| `packages/ui/src/backend/**/*.tsx` | `TruncatedCell.tsx`, `DataTable.tsx`, `FlashMessages.tsx` |
| `**/frontend/**` | Next.js frontend pages |
| `**/backend/**/*.tsx` | Next.js backoffice pages |
| `**/components/**` | React component files |
| `**/widgets/**` | Widget injection files |

> **Important**: `backend/page.tsx` is a Next.js page (ui-component). `api/GET/route.ts` is an API route (api-logic). Don't confuse them.

### API-Logic layer — Jest + Playwright

| Pattern | Examples |
|---------|---------|
| `**/api/**` | `api/GET/route.ts`, `api/POST/route.ts` |
| `**/commands/**` | `commands/createCustomer.ts` |
| `**/lib/**` | `lib/pricing.ts`, `lib/utils.ts` |
| `**/services/**` | `services/emailService.ts` |
| `**/subscribers/**` | `subscribers/onOrderCreated.ts` |
| `**/workers/**` | `workers/syncWorker.ts` |
| `**/events.ts` | Module event declarations |
| `**/notifications.ts` | Module notification declarations |
| `**/ai-tools.ts` | MCP tool definitions |

### Data layer — Jest + Playwright (schema-sensitive)

| Pattern | Examples |
|---------|---------|
| `**/data/entities*` | `data/entities.ts`, `data/entities/` |
| `**/data/migrations*` | `data/migrations/Migration001.ts` |
| `**/data/validators*` | `data/validators.ts` |
| `**/data/extensions*` | `data/extensions.ts` |
| `**/data/enrichers*` | `data/enrichers.ts` |

### Decision rule

```
layer = ui      → only if ALL changed files match UI patterns
layer = data    → if ANY changed file matches data patterns
layer = api-logic → if ANY changed file matches api-logic patterns (and none match data)
layer = mixed   → if changes span multiple layers
```

When `layer = ui`: skip Step 4 and Step 5 entirely — no Playwright.
When `layer = data` or `api-logic` or `mixed`: proceed with Playwright as normal.

## Integration Test Meta Format

Integration tests declare their module dependencies in `meta.ts` (or `index.ts`):

```typescript
// packages/core/src/modules/attachments/__integration__/meta.ts
export const integrationMeta = {
  dependsOnModules: ['attachments'],
}

// packages/core/src/modules/catalog/__integration__/meta.ts
export const integrationMeta = {
  dependsOnModules: ['shipping_carriers', 'payment_gateways', 'currencies'],
}
```

Supported keys (all equivalent): `dependsOnModules`, `requiredModules`, `requiresModules`

The existing discovery system is at `packages/cli/src/lib/testing/integration-discovery.ts`.
It reads these declarations and filters tests based on enabled modules.

## Known Cross-Module Integration Dependencies

All `__integration__` directories now have `meta.ts` files with explicit dependency declarations.
The table below documents cross-module dependencies (modules with only self-references are omitted).

| Test module | Also requires |
|-------------|--------------|
| `catalog` | `shipping_carriers`, `payment_gateways`, `currencies` |
| `customers` | `feature_toggles`, `directory`, `dictionaries` |
| `sales` | `notifications`, `catalog`, `customers` |
| `auth` | `staff` |
| `checkout` | `payment_gateways` |
| `data_sync` | `integrations` |
| `inbox_ops` | `messages` |

## Jest Run Commands

```bash
yarn test                              # All Jest tests (turbo)
yarn jest --findRelatedTests <files>   # Related tests for specific files
yarn jest <file>                       # Single test file
yarn workspace @open-mercato/core test # Single package
```

## Integration Test Run Commands

```bash
yarn test:integration                  # Full Playwright suite
yarn playwright test <spec> --config=.ai/qa/tests/playwright.config.ts  # Specific specs
yarn test:integration:coverage         # With Istanbul coverage
yarn test:integration:report           # View HTML report
```

## CI Pipeline

1. `yarn test` — all Jest tests (every PR)
2. `yarn test:integration:coverage` — Playwright on ephemeral app (every PR)

## Environment Variables Affecting Test Selection

| Variable | Effect |
|----------|--------|
| `OM_ENABLE_ENTERPRISE_MODULES=true` | Includes enterprise overlay integration tests |
| `OM_INTEGRATION_OVERLAY_ROOT` | Overrides overlay detection root (default: `packages/enterprise`) |
