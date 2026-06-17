# Handoff — 2026-06-17-inbound-webhook-handlers

**Last updated:** 2026-06-17T03:00:00Z
**Branch:** feat/inbound-webhook-handlers (pushed to `fork`)
**PR:** https://github.com/open-mercato/open-mercato/pull/3145 (DRAFT, Status: in-progress)
**Current phase/step:** Phase 4 Step 4.1 (next — first `todo` row)
**Last commit:** 6022d92fc — feat(webhooks): add inbound dispatch worker + queue helper

## What just happened (this resume: steps 2.3, 3.2 — run now 8/12)
- 2.3: `yarn generate` + `yarn db:generate` against the docker Postgres → `Migration20260617141327_webhooks.ts` + snapshot for `webhook_ingestions` + `webhook_inbound_configs`. DDL validated in a rolled-back tx (db:migrate NOT run).
- 3.2: `lib/inbound-dispatch.ts` (`processInboundDispatchJob`, idempotent, per-handler isolation, caps results to 50 / errors to 1KB, emits `inbound.processed`/`handler_failed`), queue helper `enqueueInboundDispatch` + `WEBHOOK_INBOUND_DISPATCH_QUEUE` in `lib/queue.ts`, worker `workers/inbound-dispatch.ts`, 4 unit tests.
- Checkpoint 2 green: shared+webhooks tsc clean; webhooks 117/117 tests.

## Next concrete action
- Step 4.1: add `webhookHandlers: { folder: 'webhook-handlers', include: isScriptFile }` to `SCAN_CONFIGS` in `packages/cli/src/lib/generators/scanner.ts` (lines ~129-168). `webhook-sources.ts` is a single root file — resolve it like `index.ts` in the orchestrator, NOT via SCAN_CONFIGS.

## Phase 4 (generator) — precise edit-map (from Explore agent)
Mirror how `subscribers`/`workers` are handled.
- **scanner.ts (~129-168):** add `webhookHandlers` ScanConfig (folder `webhook-handlers`, `include: isScriptFile`).
- **module-registry.ts:**
  - after ~1336: `loadWebhookHandlerMetadata()` (mirror `loadWorkerMetadata`; reads `metadata` with `source`,`event`,`id`,`persistent?`).
  - after ~1731: `processWebhookHandlers()` (mirror `processWorkers`) emitting registry entries `{ meta: { source, event, id, persistent }, handler: createLazyWebhookHandler(() => import(...)) }`; and `resolveWebhookSources()` returning a **lazy module loader** string for `webhook-sources.ts`.
  - after ~2449: `processWebhookHandlersAst()` (mirror `processWorkersAst`).
  - orchestrator (~2849-2863): call the new processors; declare `webhookSources`/`webhookHandlers` collection vars (~after 2632).
  - module decls (~2892-2929, BOTH `moduleDecls` and `runtimeModuleDecls`): emit `webhookHandlers: [...]` and `webhookSources: [...]`.
- **CRITICAL design note — sources can't be inlined.** `WebhookSourceConfig` contains FUNCTIONS (`verifier`, `eventTypeExtractor`, ...), so unlike worker metadata it cannot be serialized as an object literal. Represent `webhookSources` in the generated output as **lazy module loaders** (`() => import('.../webhook-sources')` whose `.webhookSources` export is the array), and resolve them ASYNC at bootstrap. Handlers ARE serializable (meta is plain strings + a lazy `import()` for the handler) → they map directly to `WebhookHandlerRegistryEntry`.
- **shared registry type** `packages/shared/src/modules/registry.ts` (~after line 233): add optional `webhookHandlers?: import('@open-mercato/shared/lib/webhooks').WebhookHandlerRegistryEntry[]` and a `webhookSources?` field whose shape matches the chosen lazy-loader representation (NOT `WebhookSourceConfig[]` directly unless you eagerly import). Need `createLazyWebhookHandler` helper in registry.ts (mirror `createLazyModuleWorker`).
- **bootstrap wiring:** `apps/mercato/src/bootstrap.ts` (~after 75) AND `packages/create-app/template/src/bootstrap.ts` (mirror): call `setWebhookHandlers(modules.flatMap(m => m.webhookHandlers ?? []))` and resolve+`setWebhookSources(...)` (async). Helpers are in `packages/webhooks/src/modules/webhooks/lib/inbound-registry.ts`.
- **Verify Phase 4:** `yarn generate` (must still succeed repo-wide), `yarn build:packages`, `yarn build:app`. A generator mistake breaks `yarn generate` for ALL modules — verify before committing.

## Phase 5 (route unification) — design notes
Edit `packages/webhooks/src/modules/webhooks/api/inbound/[endpointId]/route.ts`:
- At the top of `POST`, BEFORE the adapter lookup: `const source = getWebhookSource(params.endpointId)`. If `source`, run the new flow; else fall through to the EXISTING adapter path (leave it 100% unchanged).
- New flow: rate-limit (reuse `checkRateLimit`), read raw body + lower-cased headers, best-effort `JSON.parse` → `parsedBody`, build `InboundWebhookRequest`.
- **Tenant/credential resolution (security-sensitive — get right + test):** load active `InboundEndpointConfigEntity` for `sourceKey`; for each candidate scope resolve `integrationCredentialsService.resolve('webhook_source_'+sourceKey, scope)` and run `source.verifier(req, credsMap)`; first that verifies picks the tenant. Prefer `source.scopeExtractor` when present. None verify → 401.
- `eventType = source.eventTypeExtractor(parsedBody, headers)`; `messageId = source.messageIdExtractor?.(...) ?? resolveInboundReceiptMessageId(...)`.
- Dedup via existing `WebhookInboundReceiptEntity` unique (catch 23505 → `{ ok:true, duplicate:true }`).
- **OPEN QUESTION — write-time encryption:** confirm HOW `WebhookIngestionEntity.payload`/`headers` get encrypted on write. The encryption MAP drives decryption on `findWithDecryption` READ; verify there is a flush/subscriber hook that encrypts on WRITE (check how `WebhookEntity.secret` is encrypted when created — grep the integrations/webhooks write path). If writes are NOT auto-encrypted, the route must encrypt explicitly. DO NOT store plaintext PII.
- Create `WebhookIngestionEntity` (status 'received'), flush, `enqueueInboundDispatch({...})`, emit `webhooks.inbound.received` (persistent, same as today), return `{ ok: true }`. Update the route's `openApi` doc.
- 5.2: unit tests for source-first resolution, signature reject (401), dedup (duplicate), and that an unknown segment still falls back to the adapter path.

## Blockers / open questions
- Upstream (`origin`) has no write/triage access for this account → branch on `fork`, PR labels/assignee/review are maintainer-only. `om-auto-review-pr` cannot run against upstream.
- Write-time encryption question above MUST be resolved before route lands.

## Environment caveats
- Dev runtime runnable: YES — full docker stack up (`openmercatotest-app-1`, `mercato-postgres-local` healthy localhost:5432, redis/meili healthy). Use it for `db:generate` and integration verification.
- The app container mounts the MAIN repo (develop), NOT this worktree branch — run generate/build/tests in the worktree on the host (node 24 via nvm).
- Database/migration state: migration written + DDL-validated; NOT applied to the running DB.

## Worktree
- Path: .ai/tmp/auto-create-pr/inbound-webhook-handlers-20260617-144928 (intact, on branch, node_modules + dist built)
- Created this run: yes (prior run); reused this resume.

## Remaining steps
- 4.1 generator scan · 4.2 generator emit + Module type + bootstrap/template · 5.1 unify route · 5.2 route tests · then final gate (full validation + `yarn test:integration` + `yarn test:create-app:integration` + ds-guardian).
