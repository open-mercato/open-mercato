# GDPR-ready deployments — program spec

> **Tracker:** open-mercato/open-mercato#8593
> **Kind:** program spec. It orders work and names the spec that carries each package. Implement from the carrier specs, not from this file.
> **Scope record:** [Scope minimization analysis, 2026-11-20](../analysis/ANALYSIS-2026-11-20-gdpr-scope-minimization.md): per-spec dispositions, legal baseline, items moved out.

Extends: .ai/specs/2026-08-18-tenant-legal-documents-and-consent-versioning.md
Extends: .ai/specs/2026-10-22-crm-contact-permissions-and-consent-history.md
Extends: .ai/specs/enterprise/2026-11-13-sign-in-activity.md

## TLDR

A controller running Open Mercato on EU personal data cannot today export or erase one person's data across modules. Retention is mostly unbounded. The deployment docs say nothing about sub-processors or rights procedures. **Proposed (future):** eleven work packages close exactly the gaps GDPR and ePrivacy require the platform to *enable*, and nothing else. Data-subject tooling runs in the Enterprise `privacy` module, as the maintainer directed on #8593. Every core (OSS) module that holds personal data carries its own handler, and the Enterprise runner calls them all. **The compliance target is an Enterprise deployment: the Enterprise runner working together with every core, Enterprise, official and app module the client enables.** An OSS-only deployment has the handlers but no runner, so it is not a compliance target.

**Out of scope:** the controller's own legal work (lawful basis, DPAs, RoPA content, DPIA, breach register), Art. 32 hardening that GDPR does not specifically require, and convenience features. They are listed in the scope record. The security items there should be filed as ordinary issues outside this program.

## Problem Statement

Verified against `main` (2026-11-20):

- **No cross-module export or erasure.** Only `forms` has subject tooling. Deleting a CRM person is refused when deals link to it, and nothing anonymizes. Undo/audit snapshots keep deleted records indefinitely, and some keep credentials: `command-bus.ts` stores command input as a redo envelope, so password-change commands without `undo` store both passwords.
- **User deletion leaves data behind.** `auth.user.deleted` carries `id`. The channel and SSO cascade subscribers read `userId`, so their cleanup never runs. Portal-user delete only soft-deletes and leaves email, password hash and name.
- **Retention is mostly absent.** Existing pruners (portal sessions/tokens, integration logs, forms retention) are not scheduled. Action logs, notifications, webhook deliveries, soft-deleted AI chats and failed queue jobs are never pruned. Access logs are already bounded inline.
- **Published secrets.** The runtime accepts a tenant encryption key whose value is published in the repository's history. Production Compose files default Meilisearch and Postgres secrets and `DEMO_MODE`.
- **No deployment guidance.** There is no sub-processor list, rights procedure, restore-after-erasure procedure or breach runbook.

## Scope rule

Every candidate requirement was classified against the [legal baseline](../analysis/ANALYSIS-2026-11-20-gdpr-scope-minimization.md#legal-baseline):

| Tier | Meaning | Treatment |
|---|---|---|
| **T1** | Legally required capability: without it a controller using Open Mercato cannot comply | In this program |
| **T1-P** | The law accepts a documented procedure | Deployment docs only |
| **T2** | Art. 32 hardening: risk-based good practice, not a specific GDPR obligation | Out. Filed as security issues |
| **T3** | Convenience, commercial or industry rule | Out. Deferred |

## Legal basis

Each row names the minimum the platform must provide. Sources are official EU texts, EDPB guidance or national DPAs. The scope record has the full verified list.

| Obligation | Platform minimum | WP | Official source |
|---|---|---|---|
| Art. 12(2)–(3) facilitate rights within one month | Staff/admin tooling to find, export, erase one person. A self-service portal is **not** required | 6 | [EDPB Guidelines 01/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-012022-on-data-subject-rights-right-of-access_en) §136; [CNIL dev guide sheet 13](https://www.cnil.fr/en/sheet-ndeg13-prepare-exercise-peoples-rights) |
| Art. 15 access, Art. 20 portability | A complete copy in a commonly used, machine-readable form (JSON + files) | 4, 5, 6 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 15(3), 20(1); [CJEU C-487/21](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62021CJ0487); [WP242 rev.01](https://ec.europa.eu/newsroom/article29/items/611233) |
| Art. 17 erasure, 17(3) retention exceptions | Erase or irreversibly anonymize every live copy: rows, files, audit snapshots, search indexes, caches. Keep only legally required fields with a reason | 1, 2, 4, 5, 6 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 17, Recital 26; [WP216 anonymisation](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf); [EDPB CEF 2025 erasure report](https://www.edpb.europa.eu/system/files/documents/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) |
| Erasure vs backups | Procedure: keep an erasure register, re-apply erasures after any restore | 11 | [EDPB CEF 2025](https://www.edpb.europa.eu/system/files/documents/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) Issue 6 |
| Art. 18 restriction, Art. 19 recipients | Procedure (Recital 67: move the data out, or mark it and block use) | 11 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 18–19, Recital 67 |
| Art. 21(3) marketing objection; ePrivacy Art. 13 | A person-level marketing objection honoured by every marketing send path. The product sends no bulk marketing today; `List-Unsubscribe` is a Gmail/Yahoo rule, not law | 8 | [ePrivacy Directive (consolidated)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219) Art. 13 |
| Art. 7(1) demonstrate consent | Where the platform records consent: who, when, which text version | 9 | [EDPB Guidelines 05/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en) §§106–108 |
| ePrivacy Art. 5(3) cookies | None while the core sets only strictly necessary first-party cookies. The docs list them | 11 | [WP194](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf); [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en) |
| Art. 13/14 transparency | The controller's identity and notice are per tenant; the vendor is never hard-coded as controller | 9 | [WP260 rev.01](https://ec.europa.eu/newsroom/article29/items/622227) |
| Art. 5(1)(e) storage limitation | Bulk and age-based deletion; controller-set periods; bounded logs | 7 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Recital 39; [EDPB Guidelines 4/2019](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en); [CNIL sheet 14](https://www.cnil.fr/en/sheet-ndeg14-define-data-retention-period) |
| Art. 28(3)(e),(g) processor duties | Request tooling for the tenant; return or delete all tenant data at the end of service | 6, 7, 11 | [EDPB Guidelines 07/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en) §§130–142 |
| Art. 30, Art. 35 | Controller documents. The docs supply templates and the per-module data inventory | 11 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 30; [WP248 rev.01](https://ec.europa.eu/newsroom/article29/items/611236) |
| Art. 32 security (baseline only) | No published default secrets in production; no credentials in audit history | 2, 3 | [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) Art. 32; [ENISA handbook](https://www.enisa.europa.eu/publications/handbook-on-security-of-personal-data-processing) |
| Art. 33–34 breach | Logs that let the controller detect and scope a breach (sign-ins, exports); a runbook | 10, 11 | [EDPB Guidelines 9/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en) §37 |
| Chapter V transfers | Each external provider can be chosen, replaced or disabled, and its data flow documented. EU-only defaults are **not** required | 11 | [EDPB Recommendations 01/2020](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en); [SCCs 2021/914](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj); [DPF 2023/1795](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj) |

## Edition rule

The maintainer's comment on #8593 places this capability in **Enterprise**. The program follows it.

**Compliance target (owner decision, 2026-11-20).** An **Enterprise deployment must provide every capability this program marks as legally required**. The GDPR flows (export, erasure, retention runs, tenant purge) run only in Enterprise. An Enterprise client uses any core module, so each core module must ship its part of the flow, in its own package. An OSS-only deployment is not a compliance target.

**How the pieces work together.**

```text
Enterprise `privacy` module (runner: CLI, POST /api/privacy/erase, admin page)
  │  reads the generated registry of every ENABLED module's privacy.ts
  ├─► core modules (OSS code)          customers, sales, forms, messages, … → their handlers
  ├─► Enterprise modules               sso, security, record_locks, agent_orchestrator → their handlers
  ├─► official modules (separate repo) their own privacy.ts + handlers
  └─► the client's app modules         src/modules/<id>/privacy.ts + handlers
  then, once, centrally: history strip (audit_logs), file deletion (attachments),
  search-index removal (query_index/search), CRUD cache invalidation
```

- A module the client disables takes no part in a run. A module the client enables takes part through its own handler, and nothing else changes.
- A core module without a handler is a compliance gap for every Enterprise client who enables it. The coverage check therefore covers all core modules, and the Enterprise closure gate below requires none to be missing.
- Each run's report lists, under `notCovered`, every enabled module that has entities but no `privacy.ts`, with its module id. An official or app module that was never registered shows up there instead of being silently skipped.

- **OSS packages (code every Enterprise deployment runs):** independent bug and security fixes (WP1–3); the contract types in `packages/shared`; a handler in every core module that holds personal data; the coverage check (WP4–5); operational pruners for core tables (WP7); docs (WP11). Handlers are tested in their own module; in an OSS-only deployment nothing calls them.
- **Enterprise:** the new `privacy` module runs requests: export, erasure, business-record and action-log retention, tenant purge and the admin page (WP6, WP7). It also holds handlers for Enterprise modules (WP5). The sign-in log (WP10) and tenant legal documents (WP9) follow their existing Enterprise trackers (#8106, #5423).
- Module isolation requires the handlers to live in their owning modules: Enterprise code must not query core tables. This is why each core module ships its own handler, and why the Enterprise runner works only through them.

## Work packages

| WP | Package | GDPR | Ed. | Carrier | Depends on |
|---|---|---|---|---|---|
| 1 | User-delete cascade fix: subscribers read `id`; delete per-user stores and stored credentials; portal-user delete clears contact data and credentials; CRM person delete no longer fails for people with company roles | 17, 32 | O | [privacy-coverage](2026-11-16-privacy-coverage.md) Phase 1 | — |
| 2 | No passwords, hashes or tokens in command audit/undo history; cleanup migration; `stripped_at` + `actionLogService.stripForResources` | 32, 17 | O | [audit-snapshot-redaction](2026-11-16-audit-snapshot-redaction.md) | — |
| 3 | Production refuses published encryption secrets; production Compose stops defaulting Meilisearch/Postgres secrets and demo mode | 32 | O | [runtime-encryption-key-guard](2026-11-16-runtime-encryption-key-guard.md) | — |
| 4 | Personal-data registry: `privacy.ts` contract and discovery, one strategy per entity (delete, anonymize, legally retained); root handlers for staff user, CRM person and portal user; coverage check run in the monorepo **and in every standalone app's `yarn test`**; the rule in the standalone `AGENTS.md` and the module-scaffold skills, so a new module (say, bookings) is registered when it is built | 15, 17, 20, 25 | O | [privacy-data-class-contract](2026-11-16-privacy-data-class-contract.md) | — |
| 5 | Handlers for every other module holding personal data | 15, 17, 17(3) | O / E | [privacy-coverage](2026-11-16-privacy-coverage.md); [privacy-coverage-enterprise](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md) | 4 |
| 6 | Enterprise `privacy` module: subject export and erasure runs (central history strip, file deletion, search-index removal, cache invalidation), DSR log entry, admin page | 12, 15, 17, 20, 5(2) | E | [privacy-dsr-engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md) | 2, 4, 5 |
| 7 | Retention: schedule existing pruners; age pruners for operational/log tables; forms retention fix; failed queue job bound (OSS). Business-record and action-log retention runner (#2980); tenant purge (Enterprise) | 5(1)(e), 28(3)(g) | O / E | [operational-retention-pruners](2026-11-16-operational-retention-pruners.md); [privacy-dsr-engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md) | OSS part: — ; Enterprise part: 4, 6 |
| 8 | Marketing objection: the person-level `do_not_contact` / `do_not_email` suppression flags, checked before every CRM outreach send | 21(3) | O (`customers`; ships in both editions) | [10-22 consent spec](../2026-10-22-crm-contact-permissions-and-consent-history.md), smallest slice: the suppression flags and the sender-side suppression check. Purpose-level permission history is not required. **Needs a tracking issue** | — |
| 9 | Tenant-owned `/privacy` and `/terms` with neutral defaults; controller identity at every collection point (onboarding sign-up, checkout); append-only consent evidence. **Required addition:** a `marketing_email` event also records the consent label's i18n key and a SHA-256 of the rendered label text, because the carrier attaches no document to marketing consent and Art. 7(1) needs the shown wording | 13, 14, 7(1) | E (#5423) | [08-18 legal documents spec](../2026-08-18-tenant-legal-documents-and-consent-versioning.md) Phases 1–3 (Phase 4, checkout prefill, is not required) | — |
| 10 | Durable sign-in log with IP and user agent, 90-day retention (11-13 spec Phases 1–2); one action-log entry per server-side data export (actor, entity kind, format, row count), so a breach can be scoped | 32(1)(d), 33 | E (#8106) + O seam (export entry) | [11-13 sign-in spec](../enterprise/2026-11-13-sign-in-activity.md); export entry: [audit-snapshot redaction](2026-11-16-audit-snapshot-redaction.md) §7 | — |
| 11 | Deployment docs: roles, sub-processors, hardening, rights procedures (restriction, Art. 19, objection), retention table, backups and restore, breach runbook and register template, RoPA templates, DPIA notes, tenant offboarding | 13–14 facts, 18, 19, 28, 30, 33–35, Ch. V | O (docs) | [gdpr-deployment-docs](2026-11-16-gdpr-deployment-docs.md) | Stage 2 pages follow the features they describe |

WP8 is the only marketing obligation. The product sends no bulk marketing today: form invitations, staff notifications and 1:1 CRM email are not campaigns. If a campaign feature is added later, it must also add an opt-out in every message (ePrivacy Art. 13(2)).

## Phasing

| Phase | Packages | Exit |
|---|---|---|
| 1 — Live defects and docs | WP1, WP2, WP3, WP11 stage 1 | Shipped independently. No contract dependency |
| 2 — Contract and core-module coverage | WP4, then WP5 (core modules); WP7 (OSS) in parallel | No core-module table left in the coverage baseline: each is registered or exempt with a reason |
| 3 — Enterprise request tooling | WP6, WP5 (Enterprise), WP7 (Enterprise), WP11 stage 2 | **Enterprise closure gate:** coverage baseline empty (every core and Enterprise table registered or exempt), and one end-to-end test that exports and then erases a person seeded in every core and Enterprise module holding personal data, run on an Enterprise build with all modules enabled, with `notCovered` empty |
| 4 — Transparency and logging | WP8, WP9, WP10 | Can run in parallel with phases 2–3 on their own trackers |

## Known limits

The deployment docs ([index page](2026-11-16-gdpr-deployment-docs.md)) state each of these in plain words:

- Restriction (Art. 18), recipient notification (Art. 19) and backup re-application are procedures, not product features.
- An OSS-only deployment (no Enterprise package) is not a compliance target. It has the core-module handlers but no runner, no action-log bound, no sign-in log, and no tenant legal documents or consent ledger. A deployment that must meet GDPR uses Enterprise, with any core modules it needs.
- Official modules (`external/official-modules`) and a client's app modules are covered only once they ship their own `privacy.ts`. Until then each run lists them under `notCovered`. Official modules need a follow-up in their own repository.
- Operational copies (logs, queue jobs, webhook deliveries) are not removed by an erasure. They expire by their published retention windows.
- Free-text mentions of a person inside other people's records are not found automatically; the docs' erasure procedure includes a manual free-text search step.

## Risks & Impact Review

#### Erasure removes the wrong person
- **Scenario**: a lookup by email matches a different person's record.
- **Severity**: High
- **Affected area**: WP6.
- **Mitigation**: dry run by default; the report lists every matched record before `--apply`; matching uses exact identifiers only.
- **Residual risk**: operator error after review.

#### New pruners delete data an operator expected to keep
- **Scenario**: the first run after upgrade deletes old operational rows.
- **Severity**: Medium
- **Affected area**: WP7.
- **Mitigation**: every window is published in one upgrade note and configurable per table; `0` disables a pruner.
- **Residual risk**: an operator who skips the upgrade notes.

#### Production refuses to start after upgrade
- **Scenario**: an instance runs on a published key.
- **Severity**: High
- **Affected area**: WP3.
- **Mitigation**: an explicit refusal message with a runbook link; dev escape variable; the BACKWARD_COMPATIBILITY Emergency Security Exception with maintainer approval.
- **Residual risk**: downtime until the key is rotated.

#### OSS deployers read "GDPR-ready" as applying to OSS
- **Scenario**: an OSS deployer assumes the OSS edition alone meets GDPR.
- **Severity**: Medium
- **Affected area**: OSS deployments, WP11.
- **Mitigation**: the docs index states plainly that the compliance target is Enterprise and lists what OSS lacks.
- **Residual risk**: none beyond the disclosure.

#### Handlers drift as modules change
- **Scenario**: a module adds a table holding personal data and no handler covers it.
- **Severity**: Medium
- **Affected area**: WP4–5.
- **Mitigation**: the coverage test fails on any new table that is neither claimed by a class nor exempted.
- **Residual risk**: a wrong exemption reason passes review.

## Open questions for the maintainer (not gating)

1. WP8 needs an owner and a tracking issue for the suppression slice of the 10-22 spec.
2. WP3's dev-only escape variable (`OM_ALLOW_PUBLISHED_DEV_KEY`) needs a named maintainer approval under the `BACKWARD_COMPATIBILITY.md` Emergency Security Exception.
3. WP9 adds one requirement to the 08-18 carrier: the marketing-consent wording (label key plus rendered-text hash). Its owner should confirm it before implementation.

## Final Compliance Report — 2026-11-20

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No cross-module ORM relations / table access | Compliant | Owner handlers via DI; tenant purge is a documented exception (the tenant ceases to exist) |
| root AGENTS.md | Tenant scoping | Compliant | Every handler query carries `tenant_id` |
| root AGENTS.md | Integration tests ship with features | Compliant | Each carrier lists its integration coverage |
| `.ai/specs/AGENTS.md` | No enterprise-only scope in OSS dir | Compliant | Request runner and Enterprise handlers live under `enterprise/GDPR/` |
| `BACKWARD_COMPATIBILITY.md` | Breaking defaults follow the protocol | Compliant | WP3 uses the Emergency Security Exception; pruner defaults get upgrade notes |

## Changelog

- **2026-11-20 (c)**: States the Enterprise/core tandem explicitly. Enterprise runs the flows; every core module ships its handler. The Enterprise closure gate requires an empty baseline and an end-to-end test with all modules enabled. Runs report unregistered enabled modules under `notCovered`.
- **2026-11-20 (b)**: Enterprise stated as the compliance target. WP9 now points at 08-18 Phases 1–3 with the marketing-wording addition, because that carrier rejects versioning `user_consents` rows. WP10's export entry is now specified in audit-snapshot redaction §7. WP8 is narrowed to the 10-22 suppression flags.
- **2026-11-20**: Rewritten to the minimal legal scope. 41 child specs (~21.5k lines) reduced to 8 (~2.4k lines with this program); T2/T3 items moved out (see scope record); pre-existing specs edited on this branch reverted to `main`.
- **2026-11-15**: Initial program (superseded by the 2026-11-20 rewrite; full draft in git history at `d3e5a87243`).
