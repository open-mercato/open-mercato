# Notify — 2026-10-09-tpay-hosted-pln-payment-sessions

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-09T13:40:00Z — run started
- Brief: implement `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md` (Tpay hosted PLN provider foundation).
- External skill URLs: none
- Mode: Spec-implementation run.
- Decisions (user-directed): push to the `fork` remote and open the PR in `mtytula/open-mercato` against `develop`; keep the existing branch `mtytula/tpay-spec-implementation` (already on `origin/develop` + spec commit) instead of a new `feat/` branch; single-line commit subjects without trailers; no changes to `.github/workflows/package-previews.yml`; no `yarn db:migrate`.
- Decision: fork has only GitHub default labels — label guard skips missing pipeline/priority/risk labels.
- Validation runner: local (no Open Mercato app container running).

## 2026-10-09T13:30:12Z — checkpoint 1
- Steps 1.1..1.4 (incl. 1.3-review-fix) verified: package typecheck, 128 unit tests, build, i18n sync, eslint all green. UI checks skipped (no UI files).
- Delegations: 1.1, 1.2, 1.4 executor subagents (cheap/standard tier → smaller model); 1.3 executor at capable tier.
- Decision: Tasks-table `Commit` cells are filled by the following commit (a commit cannot embed its own SHA).
- Decision: Tpay HTTP client takes `environment` per call; amounts accept number or decimal string per Tpay OpenAPI "numeric"; adapter registered as `tpay:v1` + default; errors are `CrudHttpError` with translated text and `gateway_tpay.errors.*` code.

## 2026-10-09T15:48:57Z — final gate
- Validation gate green except the pre-existing upstream `core/progressService` failure; Tpay integration specs pass on a fresh ephemeral app after the full run degraded.
- Decision: push via HTTPS with `gh` credentials after the SSH agent stopped signing ("communication with agent failed").
- Note: Step 1.5 landed as two commits (`47a912c48` code + `881cd0793` plan flip) because the executor's plan edit missed the first commit.

## 2026-10-09T15:54:39Z — run completed
- om-auto-review-pr (--autofix): approve-level findings only; minors fixed in `4b22e8e99` (underpayment guard, CLI preset errors, fixture restore checks, zod dependency).
- PR: https://github.com/mtytula/open-mercato/pull/1 — flipped to ready; Status complete. Outstanding: live sandbox acceptance.

## 2026-10-09T16:19:29Z — sandbox acceptance
- Live Tpay sandbox E2E passed (redirect → simulator success → return → checkout `completed`, gateway `captured`); Tpay panel shows the transaction as paid with CRC = checkout transaction id. Failed-payment path stays `pending`.
- Tpay accepts hosted transactions without `pay`.
- Decision: keep `gateway_tpay` opt-in in the create-app template; enabling by default needs an AI-harness evaluation case (maintainer call).
