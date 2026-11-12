# Implement resumable encrypted Enterprise backup and restore

Source doc: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md
Spec PR: #8910
Status: in-progress
Engine: om-auto-create-pr (steps: 12, --loop: no)

## Goal and scope

Implement the complete #8910 recovery engine: bootstrap-free Enterprise bin, app wrapper, encrypted bounded chunks/index/journal, honest consistency, durable backup and restore resume, per-entity progress, artifact verification and quarantined exercise. Core rotation acknowledgment and Enterprise data-equivalence verification are coordinated with the separate #9328 implementation; this PR owns the backup engine and its facade only. No live restore, production key export, automatic key retirement, scheduling/S3/retention scope expansion or direct Core import of Enterprise.

## Prerequisite verification — 2026-11-12

The merged source explicitly marks Q2 and Q3 NEEDS HUMAN CONFIRMATION. PR conversation and review sweep found design approval but no age dependency/custody approval; current reviews explicitly retain these implementation gates. Merging a design did not approve those decisions. The `backups` module is absent in the inspected base. No existing open implementation PR or occupied branch slot was found.

Concrete proposal for security-owner approval:

- Pin `age-encryption` 0.3.1 (the npm registry currently reports this release; source repository FiloSottile/typage), audit exact tarball/dependency provenance before use. Approve the supported version and security boundary explicitly; the version observation is not an endorsement or completed security audit.
- Use X25519 recipients with separate operator and offline escrow recipients; no plaintext identities/DEKs in artifacts, reports, argv or logs. Do not change the spec to a custom cipher.
- Use disposable PostgreSQL plus generated test identities and synthetic historical application keys for a self-contained backup/restore/canary escrow drill. Native integration harness: module-owned Playwright tests driving the CLI with disposable-Postgres fixtures, plus existing CLI unit contract tests. No developer DATABASE_URL, real customer data or production custody is required for this implementation proof. Harness placement is resolved: executable Playwright tests belong in `packages/enterprise/src/modules/backups/__integration__/`, per `.ai/qa/AGENTS.md`; unit contracts belong in module `__tests__`. No harness-location approval is needed.
- Deployment-specific custody inventory and real operational escrow drill remain deployment acceptance, separate from synthetic implementation feasibility. Implementation must never claim a synthetic drill proves a real deployment recoverable.

Local tool probe: `age`, `pg_dump` and `psql` are absent from PATH; Docker CLI exists. Disposable container/client provisioning is an implementation prerequisite, not evidence of a completed drill. Runtime unit/integration/performance gates have not run; no runtime code is committed while Q2/Q3 implementation approval is unresolved.

## Dependency investigation — 2026-11-12

Candidate `age-encryption@0.3.1` is BSD-3-Clause and maps to official `FiloSottile/typage` tag `v0.3.1`, commit `38b8b10cb22409de0eaa8a617a01f16dc2e3f9f4`. Registry integrity: `sha512-bYgd7lxM7tEANmb9bXf7xTFB3Qpq+JGKinVSdFh5MV+t2fJJZSTdKhWkvXTFJQGysZd+K9Dt3F+n+4DKazXlnQ==`. Direct dependency ranges include Noble ciphers/curves/hashes/post-quantum and Scure base. An isolated temporary package-lock resolved this exact candidate using `npm install --package-lock-only --ignore-scripts`; `npm audit --json` reported zero known advisories (0 critical/high/moderate/low) for that resolution. No repository dependency or scripts were installed/executed. Advisory absence is not a cryptographic/security approval; exact tarball/source review and supported version selection remain Q2.

Synthetic Q3 drill proposal: generate two X25519 recipient identities and historical application test DEKs; create two-tenant fixtures with encrypted canaries; produce a quiesced encrypted artifact; remove the primary identity from the recovery host; restore to a fresh network-isolated database using only offline escrow identity plus retained historical test DEKs; compare logical fixture values and verify zero callback/queue effects. Clean all generated keys/databases/files in `finally`. An implementation approval may accept this protocol without supplying any production custody material. Real deployment escrow ownership remains deployment acceptance.

## Implementation plan and risks

Follow phases in source order; no dependency addition, crypto implementation, key mutation or production runtime work before approval. The 20-GiB spike must establish snapshot-export/chunk encryption throughput and honest resume labels. All reported completion evidence must name the tested head, environment and actual limitations. Keep required CI and independent review gates intact.

## Progress

PR: #9333

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: approval and feasibility

- [x] 0.1 Obtain explicit Q2 age version/recipient/custody approval, Q3 synthetic-vs-deployment escrow acceptance, ; record evidence without secrets.
- [ ] 0.2 Provision disposable PostgreSQL and run the 20-GiB snapshot/chunk/age feasibility spike with published resource measurements.

### Phase 1: bootstrap and encrypted backup

- [ ] 1.1 Register the Enterprise backups module/bin and disabled capability flags; sync create-app template and generated registries via native commands.
- [ ] 1.2 Implement versioned schemas, process/resource adapters, preflight and encryption policy with B01/B03/B12/B13/B15 tests.
- [ ] 1.3 Implement bounded snapshot/chunk pipeline, encrypted journal, sealing and per-entity progress with B01/B10/B18 tests.
- [ ] 1.4 Implement resume epochs, conservative consistency proof, DDL restarts, sequence reconciliation and lock recovery with B04/B05/B06/B11.

### Phase 2: verification and recovery

- [ ] 2.1 Implement offline verify/status and bootstrap-free entry point with B09/B17 contract tests.
- [ ] 2.2 Implement identity challenge, restore journal, chunk transactions, post-data/FKs and progress with B02/B07/B08/B10.
- [ ] 2.3 Implement declarative exercise and synthetic escrow/canary drill with isolation assertions B14.

### Phase 3: integration and release verification

- [ ] 3.1 Expose the backup facade for the automated pipeline and protected rotation; coordinate Core acknowledgment/verifier boundary B19/B20 with #9328 implementation without duplicate code ownership.
- [ ] 3.2 Complete B01–B20, benchmarks, operator documentation, custody guidance and configured full validation commands.
- [ ] 3.3 Run authoritative om-auto-review-pr --autofix, post verification/outcome comments, publish ready only when every step is complete and gates pass.

## Resume

First remaining step: 0.1. Request approval of the concrete package/recipient policy and synthetic drill/harness proposal above, then resume this implementation PR via `om-auto-continue-pr`. Do not substitute native spec review approval for the explicit implementation security decisions.

## Authorization — resumed 2026-11-12

User explicitly approved all pending proposals: “yes go on, the modules go to enterpirse / commercial i've got the rights to do so”. Q2/Q3 implementation policy is authorized; real deployment custody acceptance remains separate. Harness is repository-native. Production implementation now proceeds without requesting these approvals again.
