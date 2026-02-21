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
