# M. Contributor Onboarding — "Your First Module" Guide

> Step by step: from cloning the repo to merge. Includes FAQ and DS mental model.

---

### M.1 Before-You-Start Checklist

Before writing the first line of code for a new module, verify:

- [ ] **Read AGENTS.md** — the Task Router points to the appropriate guides
- [ ] **Read `packages/core/AGENTS.md`** — auto-discovery, module files, conventions
- [ ] **Read `packages/core/src/modules/customers/AGENTS.md`** — the reference CRUD module
- [ ] **Read `packages/ui/AGENTS.md`** — UI components, DataTable, CrudForm
- [ ] **Checked `.ai/specs/`** — whether a spec exists for my module
- [ ] **Tools installed**: `yarn`, Node >=20, Docker (for DB)
- [ ] **Project built**: `yarn initialize` completed without errors
- [ ] **Dev server running**: `yarn dev` works, the dashboard is visible in the browser

### M.2 Step-by-Step: Creating a Module

**Step 1 — Scaffold**
```bash
# Option A: scaffold script (from section K.3)
./ds-scaffold-module.sh invoices invoice

# Option B: manually — copy the structure from customers and clean up
```

**Step 2 — Define the entity**
```
data/entities.ts -> MikroORM entity with id, organization_id, timestamps
data/validators.ts -> Zod schema per endpoint
```
Pattern: `packages/core/src/modules/customers/data/entities.ts`

**Step 3 — Add the CRUD API**
```
api/<module>/route.ts -> makeCrudRoute + openApi export
```
Pattern: `packages/core/src/modules/customers/api/companies/route.ts`

**Step 4 — Create backend pages**
```
backend/<module>/page.tsx       -> List (template K.1.1)
backend/<module>/create/page.tsx -> Create (template K.1.2)
backend/<module>/[id]/page.tsx   -> Detail (template K.1.3)
```
**IMPORTANT**: Every template requires — `Page`+`PageBody`, `useT()`, `EmptyState`, `LoadingMessage`/`isLoading`, `StatusBadge` for statuses.

**Step 5 — ACL + Setup**
```
acl.ts   -> features: view, create, update, delete
setup.ts -> defaultRoleFeatures (admin = all, user = view)
```

**Step 6 — i18n**
```
i18n/en.json -> all user-facing strings
i18n/pl.json -> translations (if applicable)
```

**Step 7 — Registration**
```
apps/mercato/src/modules.ts -> add the module
yarn generate && yarn db:generate && yarn db:migrate
```

**Step 8 — Verification**
```bash
yarn lint                 # 0 errors, 0 warnings
yarn build:packages       # builds clean
yarn test                 # existing tests pass
yarn dev                  # new module visible in sidebar
```

### M.3 Self-Check: 10 Questions Before Submitting a PR

Answer YES to each question before opening a Pull Request:

| # | Question | Area |
|---|----------|------|
| 1 | Does **every** list page have an `<EmptyState>` with a create action? | UX |
| 2 | Do detail/edit pages have `<LoadingMessage>` and `<ErrorMessage>`? | UX |
| 3 | Do **all** user-facing strings use `useT()` / `resolveTranslations()`? | i18n |
| 4 | Are statuses rendered via `<StatusBadge>` (not raw text/span)? | Design System |
| 5 | Do status colors use semantic tokens (`text-destructive`, `bg-status-*-bg`)? | Design System |
| 6 | Do forms use `<CrudForm>` (not a manual `<form>`)? | Consistency |
| 7 | Do API routes have an `openApi` export? | Documentation |
| 8 | Do pages have `metadata` with `requireAuth` and `requireFeatures`? | Security |
| 9 | Does `setup.ts` declare `defaultRoleFeatures` for features from `acl.ts`? | RBAC |
| 10 | Does `yarn lint && yarn build:packages` pass without errors? | CI |

### M.4 Top 5 Anti-Patterns

| # | Anti-pattern | Why it is wrong | What to use instead |
|---|-------------|-----------------|---------------------|
| 1 | **Hardcoded strings** `<h1>My Module</h1>` | Breaks i18n, blocks translations | `<h1>{t('module.title', 'My Module')}</h1>` |
| 2 | **Empty table instead of EmptyState** — DataTable with 0 rows and no CTA | User does not know what to do, bounce rate increases | Conditional `<EmptyState>` with a create action when `rows.length === 0 && !search` |
| 3 | **Raw `fetch()`** instead of `apiCall()` | No auth, cache, or error handling | `apiCall('/api/...')` from `@open-mercato/ui/backend/utils/apiCall` |
| 4 | **Tailwind color classes** `text-red-600`, `bg-green-100` for statuses | Inconsistent with dark mode, no central governance | Semantic tokens: `text-destructive`, `bg-status-success-bg` |
| 5 | **Missing `metadata` with RBAC** — page without `requireAuth` / `requireFeatures` | Any logged-in user sees the page, even without permissions | Add `metadata.requireFeatures: ['module.view']` |

---

---

## See also

- [Contributor Guardrails](./contributor-guardrails.md) — page templates and scaffold script
- [Lint Rules](./lint-rules.md) — rules that CI checks on PRs
- [Principles](./principles.md) — design principles to remember
- [Contributor Experience](./contributor-experience.md) — broader approach to DX
