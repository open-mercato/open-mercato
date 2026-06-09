# app-OME-FEAT-001 — bookmarks CRUD module

A tier-1 feature-creation task in the Open Mercato Harbor eval suite. The agent must
add an app-level `bookmarks` CRUD module to a freshly scaffolded standalone Open
Mercato app, using the platform's canonical building blocks.

- **Agent prompt:** [`instruction.md`](./instruction.md) (done-state only; tests are hidden).
- **What "done" means:** a `bookmarks` module under `eval-app/src/modules/bookmarks/`
  exposing `/api/bookmarks` CRUD via `makeCrudRoute`, feature-gated, multi-tenant,
  soft-deletable, with a real migration and registered in `src/modules.ts`.

## Run model

- **Independent variable:** the OM release. The Dockerfile scaffolds
  `create-mercato-app@${OM_VERSION}`, pinning every `@open-mercato/*` dep to that
  release. CI overrides `OM_VERSION` per release.
- **Agents (pinned/controlled):** Claude Code → `claude-opus-4-8`; Codex → `gpt-5.5`.
- **Verdict:** `passed = all FAIL_TO_PASS ∧ all PASS_TO_PASS ∧ rubric_score ≥ 0.85`.

## Environment

`environment/docker-compose.yaml` — multi-container, Daytona-compatible:

| Service | Image | Role |
|---------|-------|------|
| `main` | `node:24-bookworm` (`environment/Dockerfile`) | agent + verifier container; holds `/app/eval-app` |
| `postgres` | `pgvector/pgvector:pg17` | app database |
| `redis` | `redis:7-alpine` | cache / events |
| `meilisearch` | `getmeili/meilisearch:v1.11` | search |

All services stay up for the whole task lifecycle, so the agent can run
`yarn db:migrate` during its own work.

## Verifier (`tests/`)

`tests/test.sh` → `tests/verify.mjs` (TS-native, no Reward Kit). It runs, in order:

1. **Edit guard** — git diff confined to `eval-app/**`; `node_modules/@open-mercato`
   hash unchanged (criterion `C-REUSE-1`).
2. **PASS_TO_PASS** — `yarn build` exit 0; `yarn generate` content-clean; scaffold
   tests green.
3. **FAIL_TO_PASS** — inject `tests/hidden/TC-BKM-001.spec.ts`, boot the app, run it
   over HTTP against live Postgres.
4. **Rubric** — ts-morph AST/fs checks (authoritative) + LLM judge for subjective
   criteria; weighted `rubric_score`.

Outputs `/logs/verifier/reward.json` (multi-dimensional) and a full
`judge_output_schema` record under `/logs/artifacts/`.

> `verify.mjs` is authored and iterated in the oracle build-test loop — see the spec's
> Phasing. Until then, `test.sh` fails closed (reward 0) if no reward is emitted.

## Rubric criteria

| ID | Weight | Check | Rule (summary) |
|----|--------|-------|----------------|
| C-REUSE-1 | 3 | fs | edits confined to `eval-app/**`; `@open-mercato/*` untouched |
| C-REUSE-2 | 3 | ast | CRUD via `makeCrudRoute` from `@open-mercato/shared/lib/crud/factory` |
| C-PLACE-1 | 2 | fs | standard module layout; registered in `src/modules.ts` |
| C-NAME-1 | 2 | ast | plural snake_case module/table; `bookmarks.view`/`bookmarks.manage` |
| C-ENTITY-1 | 2 | ast | UUID PK, snake_case cols, org/tenant indexed, soft delete, `note` nullable |
| C-VALID-1 | 2 | ast | zod; `url` validated; `note` optional; `z.infer`; no `any` |
| C-MIG-1 | 2 | fs+ast | real CLI migration with `up()`+`down()` |
| C-AUTH-1 | 2 | ast | per-method `requireAuth`+`requireFeatures`; no top-level `requireAuth` |
| C-SCOPE-1 | 1 | judge | minimal/idiomatic; no spurious events/widgets |

## Running

```bash
# Oracle (proves solvable + verifier correct)
harbor run -p evals/tasks/app-OME-FEAT-001 -e docker -a oracle

# Real agents (CI, Daytona)
harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a claude-code -m anthropic/claude-opus-4-8 --agent-kwarg version=<pin> --agent-env ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
harbor run -p evals/tasks/app-OME-FEAT-001 -e daytona -a codex       -m openai/gpt-5.5            --agent-kwarg version=<pin> --agent-env OPENAI_API_KEY=$OPENAI_API_KEY
```

## Layout

```
app-OME-FEAT-001/
├── instruction.md              # agent prompt (no test leakage)
├── task.toml                   # Harbor config + OM_VERSION + pins
├── environment/
│   ├── Dockerfile              # main container; scaffolds eval-app @ OM_VERSION
│   └── docker-compose.yaml     # main + postgres + redis + meilisearch
├── tests/
│   ├── test.sh                 # verifier entrypoint
│   ├── verify.mjs              # orchestration (authored in oracle loop)
│   ├── rubric.ts               # ts-morph rubric checks (authored in oracle loop)
│   └── hidden/TC-BKM-001.spec.ts   # FAIL_TO_PASS suite (never shown to agent)
├── solution/solve.sh           # oracle reference implementation
└── README.md
```
