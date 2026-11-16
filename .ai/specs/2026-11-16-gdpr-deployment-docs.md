# GDPR deployment documentation

> **Program:** package G5 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). The program schedules its first page, the sub-processor matrix, in Phase 1.
> **Evidence:** [`analysis/2026-11-15-gdpr-readiness-audit-verification.md`](analysis/2026-11-15-gdpr-readiness-audit-verification.md), verified at `main` @ `08dada9624`.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

An operator deploying Open Mercato for EU personal data finds one documentation page that mentions GDPR, about field encryption. Nothing says which third parties a deployment sends data to, which settings make it safe, or what to do when a data subject writes in or a breach is found. **Proposed (future):** a documentation section that says those things, written from the code, with each claim traceable to it, and a check that fails when a workspace package is neither in the third-party table nor on a list of packages that send nothing out. It is written in stages, so that no page describes a command before that command exists.

**Not in this spec:** legal advice. The pages state what the product does and where the controller must decide.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | One page or a section | A section of five pages | Each has a different reader: the person choosing vendors, the person configuring, the person answering a request, the person handling an incident. |
| 2 | Describe planned features | No. A page states only what is in the release it ships with | Documentation that promises an erase command which does not exist is worse than none. |
| 3 | Keep the third-party table honest | A script test: every workspace package is either named on the page or on an explicit list of packages that send no data out | A list of provider-name patterns would miss telephony, web research, the assistant, search, telemetry and webhooks. Inverting it makes a new package fail until someone decides. |
| 4 | Notification and assessment templates | Structure and prompts only, no legal wording | The controller's lawyer owns the wording. |
| 5 | Where it lives | `apps/docs/docs/deployment/gdpr/`, plus a short section in the create-app README that links to it | The issue asks for both. |

## 📝 Problem Statement

- `apps/docs/docs/user-guide/encryption.mdx` is the only page that mentions GDPR. Sub-processors, data-processing agreements and data residency appear only in passing in two AI pages.
- The third parties a deployment calls are decided by configuration scattered across modules, and some are active by default:

| Purpose | Default | Decided by |
|---|---|---|
| Transactional email | Resend | The system email provider setting; SES and SMTP packages also ship |
| Language model | OpenAI, active once `OPENAI_API_KEY` is set | An environment-level key and default model; tenants can override the provider |
| Embeddings | OpenAI, with the same key; automatic indexing is off in the example environment | Global, per database |
| Attachment text extraction | OpenAI, with the same key; enabled by default | No provider choice |
| Map tiles (deals map, EUDR plot map) | OpenStreetMap | A build-time variable |
| Form captcha | Off | When on, the respondent's browser loads the provider's widget and the server forwards their IP |
| Telemetry | Off | `TELEMETRY_BACKEND` selects a backend; traces, metrics and optional browser telemetry are sent to it |
| Payment, messaging, push, telephony | Per installed provider package | Each package |

- One API key therefore switches on three separate flows to the same vendor. Nothing tells an operator that.
- The product's own legal pages name the vendor as controller. The index page says so and points to the tenant legal-documents work (program package E1) as the fix.
- There is no runbook for a data-subject request or a breach, and the commands such a runbook would use are being specified now.

## 📝 Proposed Solution

Five pages, each with a named reader and a rule for what may appear on it.

| Page | Reader | Content | Source of truth |
|---|---|---|---|
| `index` | Anyone deciding to deploy | What the platform does, what stays with the controller, the list of known limits | The program spec's coverage map, restated for operators |
| `sub-processors` | Whoever signs vendor agreements | One row per outbound integration: what data it receives, when it is active, how to change or disable it, whether an EU-hosted option exists | Code, cited per row; the check below |
| `hardening` | Whoever configures production | Privacy-specific items only: encryption secrets, search exclusion, demo mode, retention windows, scheduler and workers running. For everything else it links to the existing production-readiness and readiness-scanner pages, which stay authoritative | Each item names the setting and, once it exists, the doctor check id |
| `data-subject-requests` | Whoever answers a request | Access, rectification, erasure, by subject type; which commands to run; what is not covered | The commands that exist in that release |
| `breach-response` | Whoever handles an incident | What the product can tell you (sign-in log, audit log, access log and their retention), what to preserve, the 72-hour clock, the structure of a notification | Log and retention behaviour, cited |

A sixth short page, `impact-assessment-notes`, lists the processing that usually triggers an assessment — AI features over CRM data, call recording, profiling fields — and the facts an assessor will ask for.

**Topics each page must also cover**

| Topic | Where |
|---|---|
| Where data is processed and whether it leaves the EU | A region column on `sub-processors` |
| Pointer to a data-processing agreement template | `index` |
| Cookies the product sets, all first-party | A table on `index` |
| Application logs and what they may contain | `hardening` |
| Backups, and restoring after an erasure | `data-subject-requests` |
| Portability, restriction and objection | `data-subject-requests`, stating what the product does and does not do |
| An inventory of personal data by module | `index`, linking to the data-class list command once it exists |
| Tenant offboarding | `data-subject-requests`, once the tenant exit export exists |

**Stages**

| Stage | Ships with | Pages |
|---|---|---|
| 1 | Program Phase 1 | `index`, `sub-processors`, `hardening` for what exists today |
| 2 | The export command | `data-subject-requests`: access |
| 3 | The erase command and retention pruners | `data-subject-requests`: erasure; `hardening`: retention windows |
| 4 | The sign-in log | `breach-response`, `impact-assessment-notes` |

**The check.** A script test lists every workspace package. Each must appear either in the `Package` column of the sub-processors table, written in backticks, or in a short data file of packages that send nothing out, with a reason. The test fails for a package in neither, and for a table row naming a package that no longer exists. Flows that start inside core — captcha, map tiles, text extraction — have rows under `core`, and the official-modules repository is named as outside the check.

| Alternative | Why rejected |
|---|---|
| Generate the table from code | Providers do not declare what data they send or where it goes; a generated table would have empty columns that look authoritative. The doctor's later processor report can feed it. |
| One long page | Four readers, four tasks. |
| Wait until every feature ships | The vendor table and the hardening list are useful today. |

## 📝 Architecture

Documentation pages in `apps/docs/docs/deployment/gdpr/`, registered in the docs sidebar; a README section in `packages/create-app`; one node test under `scripts/__tests__/`. No application code.

## 📝 Data Models

None.

## 📝 API Contracts

None. The pages cite settings and command names owned by other specs and must be updated in the same change when one of those changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Handling |
|---|---|
| A package is added | The check fails until the page has a row or the package is listed as sending nothing out |
| A default changes in code | The page is wrong until edited. Each row cites its file so a reviewer of the code change can find it; the review checklist gains one rule for this |
| A feature is described before it ships | Prevented by the staging rule and by review |
| An operator reads the pages as legal advice | Each page opens by saying what it is and is not |
| Installed modules differ from the defaults | The sub-processors page is organised by package, so an operator reads only the rows for what they installed |

## 📝 Migration & Backward Compatibility

Documentation only.

## 📋 Implementation Plan

### Stage 1
1. Add `index`, `sub-processors` and `hardening`, each claim cited to the code as of the release. Register them in the sidebar.
2. Add the package-coverage test and its list of packages that send nothing out.
3. Add the create-app README section.
4. Add a review rule, in the checklist's own card format, that a change to an outbound integration or to a privacy-relevant default updates the page.

### Stages 2 to 4
One step each, in the change that ships the feature the page describes, as the stage table lists.

| File | Action |
|---|---|
| `apps/docs/docs/deployment/gdpr/{index,sub-processors,hardening,data-subject-requests,breach-response,impact-assessment-notes}.mdx` | Create, by stage |
| `apps/docs/sidebars.*` | Modify |
| `scripts/__tests__/gdpr-subprocessor-coverage.test.mjs` | Create |
| `packages/create-app` README | Modify |
| The review checklist's reference card for documentation rules | Modify |
| `scripts/__tests__/gdpr-no-outbound-packages.json` | Create |

## 🧪 Integration Coverage

No API or UI path. The docs build must pass, and the package-coverage test runs in the script test suite.

## 📝 Risks & Impact Review

#### The pages drift from the code
- **Scenario**: A default or a provider's behaviour changes and the page keeps the old claim.
- **Severity**: High
- **Affected area**: operators' vendor and configuration decisions
- **Mitigation**: Per-row citations, the package-coverage test, the review rule.
- **Residual risk**: A changed default inside an existing provider is caught only by review.

#### The pages are read as a compliance guarantee
- **Scenario**: An operator treats the checklist as sufficient.
- **Severity**: Medium
- **Affected area**: operators
- **Mitigation**: The index states the controller's own duties and the known limits first.
- **Residual risk**: Readers who skip the index.

#### A page describes something that is not there
- **Scenario**: A page ships ahead of its feature.
- **Severity**: Medium
- **Affected area**: an operator answering a real request
- **Mitigation**: The staging rule ties each page to a feature's change.
- **Residual risk**: Low.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`. Not reviewed: any docs-site guide.

| Rule | Status | Notes |
|---|---|---|
| No enterprise-only scope in the OSS directory | Compliant | Enterprise features are described on their own pages when they ship |
| Ask before changing review automation | Needs approval | One rule added to the review checklist's cards |
| Integration coverage | N/A | Documentation |

**Verdict:** approved for Stage 1.

## Changelog

### 2026-11-16
- Written autonomously. No Delta section: a documentation-only change.
- Revised after independent review: two rows of the third-party table were wrong (the language model is on by an environment key, and telemetry is selected by one backend setting); the coverage check was inverted so that every package is either listed or explicitly exempt; the hardening page defers to the existing readiness pages; missing topics added.
