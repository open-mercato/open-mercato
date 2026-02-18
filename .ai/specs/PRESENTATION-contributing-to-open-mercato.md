# Contributing to Open Mercato — 30-Minute Presentation Plan

**Audience:** Developers interested in contributing to the project
**Duration:** ~30 minutes (+ Q&A)
**Goal:** Take someone from zero to confident first-PR contributor

---

## Slide 1 — Title (1 min)

**"Contributing to Open Mercato"**

- What we'll cover: install → understand → spec → implement → test → PR
- Prerequisites: Node 24+, PostgreSQL, Redis, Git, a code editor

---

## Slide 2 — What is Open Mercato? (2 min)

- Open-source modular ERP / commerce platform
- **Tech stack:** Next.js 16, React 19, TypeScript, MikroORM, PostgreSQL, Redis, Meilisearch
- **Monorepo** managed with Yarn 4 workspaces + Turborepo
- Two entry points:
  - **Monorepo contributor** — clone the main repo
  - **Standalone app developer** — `npx create-mercato-app`
- Live demo at demo.openmercato.com

---

## Slide 3 — Repository Structure (3 min)

```
open-mercato/
├── apps/
│   ├── mercato/          # Main Next.js app
│   └── docs/             # Docusaurus docs site
├── packages/
│   ├── core/             # Business modules (auth, catalog, customers, sales…)
│   ├── shared/           # Cross-cutting utils, types, i18n, DSL
│   ├── ui/               # Reusable components, forms, tables
│   ├── search/           # Meilisearch integration
│   ├── events/           # Event bus
│   ├── queue/            # Background workers
│   ├── cache/            # Caching layer
│   ├── cli/              # Generators & scaffolding
│   ├── ai-assistant/     # MCP tools for AI chat
│   └── …                 # onboarding, content, create-app, scheduler
├── .ai/
│   ├── specs/            # Architecture Decision Records
│   └── skills/           # Agent task guidance
├── AGENTS.md             # Master architecture guide + Task Router
├── CONTRIBUTING.md        # Branch model, PR guidelines
└── README.md             # Quick start
```

**Key point:** Each package and module has its own `AGENTS.md` with detailed conventions — always read it before touching that area.

---

## Slide 4 — Dev Environment Setup (4 min)

### Live demo: clone to running app

```bash
# 1. Clone and switch to develop
git clone https://github.com/open-mercato/open-mercato.git
cd open-mercato
git checkout develop

# 2. Install dependencies
yarn install

# 3. Configure environment
cp apps/mercato/.env.example apps/mercato/.env
# Set: DATABASE_URL, JWT_SECRET, REDIS_URL

# 4. One-command bootstrap
yarn dev:greenfield
# → builds packages → generates module registries
# → runs migrations → seeds data → starts dev server

# 5. Open http://localhost:3000/backend
```

### Docker alternative (show docker-compose.fullapp.dev.yml)
```bash
docker compose -f docker-compose.fullapp.dev.yml up --build
```

### Key commands cheat sheet
| Command | Purpose |
|---------|---------|
| `yarn dev` | Start dev server |
| `yarn build` | Full build |
| `yarn test` | Run all tests |
| `yarn lint` | Lint everything |
| `yarn generate` | Regenerate module registries |
| `yarn db:generate` | Create DB migration |
| `yarn db:migrate` | Apply migrations |

---

## Slide 5 — Branch Model & Workflow (2 min)

```
main ────────────────────── release-ready, every commit tagged
  │
develop ─────────────────── nightly integration branch
  │
  ├── feat/my-feature ───── feature branches
  ├── fix/my-bugfix ─────── bug fix branches
  └── docs/update-xyz ───── documentation branches
```

**Rules:**
1. Branch from `develop` (unless hotfix → branch from `main`)
2. Keep rebased on `develop`
3. PR targets `develop`
4. Descriptive commit messages
5. Reference issues in PR description

---

## Slide 6 — Spec-Driven Development (5 min)

### Why specs?

- Align on design **before** writing code
- Living documentation that stays with the repo
- Located in `.ai/specs/` — 25+ existing specs to reference

### Spec lifecycle

```
1. Check .ai/specs/ for existing spec
         │
2. Create SPEC-{number}-{date}-{title}.md
         │
3. Write skeleton (TLDR + key sections)
         │
4. Iterate with maintainers
         │
5. Implement (reference spec in PRs)
         │
6. Update spec changelog after changes
```

### Spec structure (required sections)

- **TLDR & Overview** — one paragraph summary
- **Problem Statement** — what's broken or missing
- **Proposed Solution** — high-level approach
- **Architecture** — diagrams, module interactions
- **Data Models** — entities, relations, Zod schemas
- **API Contracts** — endpoints, request/response shapes
- **UI/UX** — wireframes or descriptions (if applicable)
- **Implementation Approach** — phased breakdown
- **Alternatives Considered** — why not X?
- **Changelog** — dated entries tracking evolution

### Example: Show SPEC-022 (POS Module) or SPEC-019 (2FA)

Quick walkthrough of a real spec to show the level of detail expected.

---

## Slide 7 — Module Anatomy (5 min)

### Auto-discovery convention — no manual registration

```
packages/core/src/modules/<module>/
├── index.ts              # Module metadata
├── acl.ts                # RBAC feature declarations
├── setup.ts              # Tenant initialization hooks
├── events.ts             # Typed event declarations
├── search.ts             # Search indexing config
├── notifications.ts      # Notification types
├── ce.ts                 # Custom entities / field sets
├── di.ts                 # Dependency injection registrar
├── data/
│   ├── entities.ts       # MikroORM entities
│   ├── validators.ts     # Zod validation schemas
│   └── extensions.ts     # Cross-module data links
├── api/
│   └── <method>/<path>.ts  # REST endpoints (auto-discovered)
├── backend/
│   └── <path>.tsx        # Admin pages (auto-discovered)
├── frontend/
│   └── <path>.tsx        # Storefront pages
├── subscribers/
│   └── *.ts              # Event handlers
└── workers/
    └── *.ts              # Background job handlers
```

### Key conventions
- **Reference module:** `customers` — copy its patterns for new CRUD
- API routes MUST export `openApi` for docs
- Use `makeCrudRoute` for standard CRUD endpoints
- Validate all inputs with Zod (`data/validators.ts`)
- No cross-module ORM relationships — use FK IDs + event bus

---

## Slide 8 — Implementation Walkthrough (4 min)

### Example: Adding a simple feature (e.g., a new entity to an existing module)

```
Step 1: Read the AGENTS.md Task Router → find the right guide
Step 2: Check .ai/specs/ for related specs
Step 3: Write your spec (if non-trivial)
Step 4: Create the branch
         git checkout develop && git pull
         git checkout -b feat/my-feature

Step 5: Implement
         - Add entity in data/entities.ts
         - Add validator in data/validators.ts
         - Add API route in api/
         - Add backend page in backend/
         - Run: yarn generate (to update module registries)
         - Run: yarn db:generate (to create migration)

Step 6: Test (see next slide)
Step 7: Verify build
         yarn lint && yarn build
```

---

## Slide 9 — Writing Tests (3 min)

### Test setup
- **Framework:** Jest 30 with ts-jest
- **Pattern:** `__tests__/*.test.ts` co-located with source
- **Run:** `yarn test` (all) or `yarn test <path>` (specific)

### What to test
| Layer | What to test | Example location |
|-------|-------------|------------------|
| **Validators** | Zod schema edge cases | `data/__tests__/` |
| **API routes** | Request/response contracts | `api/__tests__/` |
| **Commands** | Undo payloads, scope guards | `commands/__tests__/` |
| **Utils** | Pure functions | `utils/__tests__/` |
| **Components** | Form validation, submission | `components/__tests__/` |

### Example test (from customers module)
```typescript
// commands/__tests__/shared.test.ts
describe('extractUndoPayload', () => {
  it('captures entity state before mutation', () => {
    const payload = extractUndoPayload(entity, fields);
    expect(payload).toMatchObject({ /* expected snapshot */ });
  });
});
```

### CI runs on every PR
- `.github/workflows/ci.yml` → lint + typecheck + test

---

## Slide 10 — Creating Your Pull Request (2 min)

### PR checklist

1. **Title:** Short, descriptive (under 70 chars)
2. **Description includes:**
   - What changed and why
   - User impact
   - Architecture notes (if applicable)
   - Link to spec (if one exists)
   - Screenshots/recordings for UI changes
3. **Before submitting:**
   - `yarn lint` passes
   - `yarn test` passes
   - `yarn build` succeeds
   - Translations in sync
   - Spec updated (if applicable)
4. **Target branch:** `develop` (unless hotfix)

---

## Slide 11 — AI-Assisted Development (2 min)

### The `.ai/` directory — unique to this project

- **AGENTS.md files** — every package/module has one; they serve as both human docs and AI agent instructions
- **Skills** (`.ai/skills/`) — reusable task patterns:
  - `spec-writing` — guides spec creation
  - `code-review` — guides code reviews
  - `backend-ui-design` — guides admin page development
- **Lessons** (`.ai/lessons.md`) — post-mortems that prevent repeated mistakes

### Using Claude Code / Codex with the repo
```bash
# Skills are auto-available
yarn install-skills    # links .ai/skills → .claude/skills

# Then in Claude Code:
/spec-writing          # triggers the spec-writing workflow
```

---

## Slide 12 — Quick Reference Card & Q&A (2 min)

### Your first contribution in 5 steps

```
1. Fork & clone → git checkout develop
2. yarn dev:greenfield (one-command setup)
3. Read AGENTS.md Task Router → find the right guide
4. Branch → Spec → Implement → Test → PR
5. Target develop, link your spec, describe user impact
```

### Key files to bookmark
| File | Purpose |
|------|---------|
| `AGENTS.md` | Architecture & Task Router |
| `CONTRIBUTING.md` | Branch model & PR guidelines |
| `.ai/specs/` | Existing specifications |
| `packages/core/src/modules/customers/` | Reference CRUD module |
| `packages/ui/AGENTS.md` | UI component guidelines |

### Resources
- Docs: docs.openmercato.com
- Demo: demo.openmercato.com
- Issues: github.com/open-mercato/open-mercato/issues

---

## Timing Summary

| Slide | Topic | Duration |
|-------|-------|----------|
| 1 | Title & intro | 1 min |
| 2 | What is Open Mercato? | 2 min |
| 3 | Repository structure | 3 min |
| 4 | Dev setup (live demo) | 4 min |
| 5 | Branch model | 2 min |
| 6 | Spec-driven development | 5 min |
| 7 | Module anatomy | 5 min |
| 8 | Implementation walkthrough | 4 min |
| 9 | Writing tests | 3 min |
| 10 | Creating PRs | 2 min |
| 11 | AI-assisted development | 2 min |
| 12 | Quick reference & Q&A | 2 min |
| **Total** | | **~35 min with Q&A** |

---

## Speaker Notes & Tips

- **Slide 4 (Setup):** If doing a live demo, have the environment pre-cloned with deps installed. Show the `yarn dev:greenfield` output, but don't wait for the full boot — switch to a pre-running instance.
- **Slide 6 (Specs):** Open a real spec file in the editor. Walk through the sections. This is the most unfamiliar concept for most contributors.
- **Slide 7 (Module Anatomy):** Have the `customers` module open in a file explorer. Click through the actual files to show the convention in practice.
- **Slide 8 (Implementation):** If time allows, do a mini live-coding: add a dummy entity, generate migration, show the auto-discovery.
- **Keep terminal output visible** — developers connect with real commands, not abstract diagrams.
