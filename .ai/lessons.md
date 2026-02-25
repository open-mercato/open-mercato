# Lessons

# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

## Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

## Flush entity updates before running relation syncs that query

**Context**: `catalog.products.update` mutates scalar fields and then calls `syncOffers` / `syncCategoryAssignments` / `syncProductTags`, which perform `find` queries. MikroORM auto-flush + subscriber logic reset `__originalEntityData`, resulting in no change sets and no UPDATE being issued.

**Problem**: Updates to the main entity silently did not hit the database when relation syncs executed before the flush.

**Rule**: If an update command mutates scalar fields and then performs relation-sync queries, flush the main entity changes *before* those syncs (or split into two UoWs/transactions).

**Applies to**: Commands that update a core record and then call sync helpers that query/modify relations using the same `EntityManager`.

## Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, and related template-only wrapper components.

## MUST use Button and IconButton primitives — never raw `<button>` elements

**Context**: The codebase was refactored to replace all raw `<button>` elements with `Button` and `IconButton` from `@open-mercato/ui/primitives`. This ensures consistent styling, focus rings, disabled states, and dark mode support across the entire application.

**Rules**:

1. **Never use raw `<button>` elements** — always use `Button` or `IconButton` from `@open-mercato/ui`.
2. **Use `IconButton` for icon-only buttons** (no text label, just an icon). Use `Button` for everything else (text-only, icon+text, or any button with visible label content).
3. **Always pass `type="button"` explicitly** unless the button is a form submit (`type="submit"`). Neither `Button` nor `IconButton` sets a default type, so omitting it defaults to `type="submit"` per HTML spec, which can cause accidental form submissions.
4. **Tab-pattern buttons** using `variant="ghost"` with underline indicators MUST include `hover:bg-transparent` in className to suppress the ghost variant's default `hover:bg-accent` background.
5. **For compact inline contexts** (tag chips, toolbar buttons, inline list items), add `h-auto` to className to override the fixed height from size variants.

**Button variants and sizes quick reference**:

| Component | Variants | Sizes | Default |
|-----------|----------|-------|---------|
| `Button` | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | `default` (h-9), `sm` (h-8), `lg` (h-10), `icon` (size-9) | `variant="default"`, `size="default"` |
| `IconButton` | `outline`, `ghost` | `xs` (size-6), `sm` (size-7), `default` (size-8), `lg` (size-9) | `variant="outline"`, `size="default"` |

**Common patterns**:
- Sidebar/nav toggle: `<IconButton variant="outline" size="sm">`
- Close/dismiss: `<IconButton variant="ghost" size="sm">` with `<X />` icon
- Tab navigation: `<Button variant="ghost" size="sm" className="h-auto rounded-none hover:bg-transparent border-b-2 ...">`
- Dropdown menu items: `<Button variant="ghost" size="sm" className="w-full justify-start">`
- Toolbar formatting buttons: `<Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs">`
- Muted section headers: `<Button variant="muted" className="w-full justify-between">`

**Applies to**: All UI components across `packages/ui`, `packages/core`, and `apps/mercato`.

## WeakSet-based circular reference detection drops shared (non-circular) object references

**Context**: The CLI OpenAPI generator (`packages/cli/src/lib/generators/openapi.ts`) used a `WeakSet` in `safeStringify` to detect circular references during JSON serialization. The `zodToJsonSchema` converter uses a `WeakMap` memo cache that returns the same JS object reference for identical Zod schema instances (e.g., `currencyCode` shared between quote and line item schemas).

**Problem**: The `WeakSet` treated shared-but-non-circular references as circular, dropping them on second encounter. This caused properties like `currencyCode` to vanish from nested schemas in the generated `openapi.generated.json`. The line item schema was missing required fields, which misled AI agents and broke API payload construction.

**Rule**: When detecting circular references in JSON serialization, use stack-based ancestor tracking (checking only the current path from root to node) instead of a `WeakSet` (which tracks all previously visited nodes globally). Shared references are legitimate and must be cloned, not dropped.

**Applies to**: Any serialization code that processes object graphs with shared references (common in Zod schema conversions, AST tools, and dependency graphs).

## Inject TypeScript types into LLM tool descriptions for correct API payloads

**Context**: The AI Code Mode tools (`search` + `execute`) require the LLM to construct API payloads. When the LLM must query a separate tool to discover schema fields and then mentally translate a compact JSON format, it frequently constructs wrong payloads and enters debug spirals (20+ tool calls, 50+ API requests).

**Problem**: Without inline type information, the LLM guesses field names and structures, sends bad payloads, gets 400 errors, then experiments with variations — wasting tokens and user time.

**Rule**: For LLM-facing tools that construct structured API calls, pre-generate compact TypeScript type stubs from the OpenAPI spec at startup and inject them directly into the tool description. This mirrors Cloudflare's `generateTypes()` pattern. The LLM sees the correct types immediately without needing an extra discovery step.

**Applies to**: Any AI tool that requires the LLM to construct structured payloads (API calls, database queries, form submissions).

## Format Zod validation errors for LLM consumption

**Context**: When the API returns 400 errors with raw Zod validation output (nested `issues[]` arrays, `fieldErrors` maps, or raw arrays), the LLM struggles to interpret the error structure and extract actionable fix instructions.

**Problem**: The LLM sees verbose JSON like `[{"code":"invalid_type","expected":"string","path":["lines",0,"currencyCode"]}]` and may not correctly identify which field to fix, leading to trial-and-error debugging.

**Rule**: Format validation errors into a concise human-readable string before returning to the LLM. Handle all Zod error formats (v3 `issues[]`, v4 `fieldErrors`/`formErrors`, raw arrays) and produce fix instructions like `"Validation failed — lines[0].currencyCode: expected string. Fix the listed fields and retry."` Fall back to `JSON.stringify` for unrecognized formats.

**Applies to**: Any AI-facing API wrapper that surfaces validation errors to an LLM agent.

## MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing

**Context**: `@PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })` configures PostgreSQL to generate UUIDs at INSERT time. When `em.create(Entity, data)` is called without an explicit `id`, the entity's `id` field is `undefined` until `em.flush()` executes the INSERT.

**Problem**: In `sales/commands/documents.ts`, the quote/order creation code called `em.create(SalesQuote, { ... })` without providing an `id`, then immediately referenced `quote.id` when re-validating inline line items via `quoteLineCreateSchema.parse({ quoteId: quote.id })`. Since `quote.id` was `undefined`, Zod validation failed with "quoteId: Invalid input: expected string, received undefined" — silently breaking inline line creation for both quotes and orders.

**Rule**: When creating an entity and immediately referencing its PK (before flush), generate the UUID client-side via `crypto.randomUUID()` and pass it explicitly: `em.create(Entity, { id: randomUUID(), ... })`. This ensures the PK is available immediately for child entity creation.

**Applies to**: Any `em.create()` call where the entity's PK is referenced before `em.flush()`, especially parent-child patterns where children need the parent's ID.
