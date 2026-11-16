# Restriction of processing and objection: what the product can and cannot do

> **Program:** package C10 of [`../../GDPR/2026-11-15-gdpr-ready-deployments-program.md`](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Proposed by the program; it is not in the issue.
> **Status: decision record, option A (program DEC-8).** A documented procedure, with no record freeze and no technical restriction. A first design blocked edits but left other processing paths open. This document records why that is insufficient, what a technical restriction would require, and which manual controls are available or still proposed.
> **Code baseline:** supplied repository snapshot at the spec commit. Current-code claims were rechecked there; no runtime behavior was tested.
> **Written autonomously.** No question was put to a person.

Extends: .ai/specs/enterprise/GDPR/2026-11-16-privacy-dsr-engine.md

## 📝 TLDR

A person may ask a controller to stop processing their data while a dispute is settled. Edits are processing too. Blocking edits is necessary for an ordinary freeze, but does not implement Art. 18 while reads, automation and disclosures continue. The product has no single path covering all those uses. **Decided (program DEC-8):** document a manual procedure and its edition-specific limits; do not claim that a legal hold or an edit freeze is technical restriction. The hold, export and contact-permission designs below are proposed controls, with availability stated per edition.

## 📝 Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
|---|---|---|
| Q1. Procedure, record freeze or technical restriction? | A, a documented procedure that states plainly the product has no technical per-person restriction (program DEC-8). G5 publishes it as the deployment-docs page `restriction-and-objection` | A freeze (B) blocks edits while reads, the assistant, reports, automation and disclosures continue, so it does not implement Art. 18 and invites being read as if it did. C needs every read, write and sender path inventoried and enforced across modules. No runtime behavior ships, and nothing expands into a cross-module freeze |

| Option | What the controller gets | Cost |
|---|---|---|
| A. Procedure only | Manual handling instructions using controls available in the deployment's edition, without a technical-restriction claim | A docs page and controller review |
| B. Record freeze | Blocks specified edits, deletion and erasure with a banner; reads, reports and disclosures remain outside it unless separately covered | Requirements below; OSS guard/enricher plus enterprise controls, with a command-by-command audit |
| C. Technical restriction | Controls permitted use across edits, read paths, exports, the assistant, reports, automation and disclosures, with documented exceptions | Inventory/enforce both API-backed tools and independent ORM/analytics/projection/sender paths; cost not estimated |

Decision: **A** (program DEC-8). B and C are the alternatives considered and rejected for this program: B blocks some processing and would have to describe its remaining gaps; C requires a new cross-module design. The freeze requirements below are kept for any later spec; none is planned.

## 📝 What the law asks

The [adopted GDPR text, Arts. 4(2), 18, 19 and 21](https://www.legislation.gov.uk/eur/2016/679/pdfs/eur_20160679_adopted_en.pdf) is the source for this summary. Alteration is processing; a storage exception does not permit ordinary editing.

- **Art. 18(1)**: restriction when accuracy is contested, when processing is unlawful and the person prefers restriction to erasure, when the controller no longer needs the data and the person needs it for a legal claim, or while an objection is assessed.
- **Art. 18(2)**: restricted data may be stored. Any other use needs the person's consent, or is for legal claims, the protection of another person, or important public interest.
- **Art. 18(3)**: the person must be told before the restriction is lifted.
- **Art. 19**: recipients the data was disclosed to must be told of the restriction, unless that is impossible or disproportionate.
- **Art. 21**: a general objection must be honoured unless the controller shows compelling grounds; an objection to direct marketing must always be honoured.

## 📝 What the code allows

**Reads have no common path.** The people list goes through `makeCrudRoute` and the query engine (`customers/api/people/route.ts:85-95`). The assistant list is `defineApiBackedAiTool` and detail uses `createAiApiOperationRunner` against the people APIs (`packages/core/src/modules/customers/ai-tools/people-pack.ts:89-90, 134, 183`); only its company-filter prequery reads profiles through `findWithDecryption` (`:111`). An API restriction could cover those list/detail calls, but cannot cover the independent paths below by itself. A dashboard widget uses the ORM (`customers/api/dashboard/widgets/new-customers/route.ts:70`). Analytics reads the table by name (`customers/analytics.ts:5-20`).

**Writes do not all go through commands.**

- Inbound and sent email create interactions by the ORM (`customers/lib/link-channel-message-handler.ts:514-548`).
- Workflow tasks persist links the same way (`lib/link-workflow-task-handler.ts:118-127`).
- The next-interaction projection updates the person by a raw query (`lib/interactionProjection.ts:64, 78`).
- Attachments, sales and phone calls write data tied to a person in their own modules.

**Commands can be refused, with gaps.**

- A command interceptor's `beforeExecute` can refuse, for requests, workers, workflows and the assistant (`packages/shared/src/lib/commands/command-bus.ts:312-319`). It receives the command's input, untyped; for a comment, an address or a task that is only the child's id.
- Undo runs `beforeUndo` with saved input, log entry and token (`packages/shared/src/lib/commands/command-bus.ts:588-598`); this is distinct from the normal input resolver. Atomic redo and undo also invoke the matching interceptors inside their replay transaction (`:481, 666`); an implementation must cover both hook inputs and the non-command writes below.
- An interceptor that declares features is filtered by wildcard-aware authorization (`packages/shared/src/lib/commands/command-interceptor-runner.ts:53-57`), so such a feature must not accidentally exempt the user whose writes it should stop.

**Outbound.** The CRM compose route takes raw recipient addresses rather than per-recipient person ids (`packages/core/src/modules/customers/api/people/[id]/emails/route.ts:31-35`). Other modules send mail too. The 10-22 [contact-permissions spec](../../2026-10-22-crm-contact-permissions-and-consent-history.md#proposed-outbound-enforcement-seam)'s planned seam is a registered outbound policy that denies with its own code; it is not built.

**Screens.** A form's read-only state is a property of the host page (`packages/ui/src/backend/CrudForm.tsx:457`); an injected widget can show a banner and refuse a save, and cannot make a form read-only. The person page also edits through tabs and a sidebar that are not that form.

**Status codes.** 423 already signals lock conflicts in `packages/enterprise/src/modules/record_locks/api/acquire/route.ts` and a locked cart in `packages/core/src/modules/cart/lib/lockGuard.ts`. Reusing it would conflate independent conditions.

## 📝 Option A — the procedure

A page in the deployment docs, "Restriction and objection", states availability before recommending an action. The OSS export/erasure/retention commands, enterprise holds and E2 contact permissions are future controls until their respective designs ship. None currently supplies general technical restriction.

| Request | Edition / availability | Procedure and limits |
|---|---|---|
| "Do not erase; I need it for a claim" | Enterprise, only with the approved governance engine deployed | Place a legal hold. The guarded erase service, hold-aware forms retention and engine/OSS record-retention paths honour it; R3-5, "Holds, honestly", and DEC-C, "Retention sets and holds", define the boundary. Forms leave held subjects out or skip as `hold_not_honourable`; guard failure refuses. A set unable to attribute held records skips for the whole tenant with `hold_not_honourable`. A record policy with `allowUnmatchedHolds` still deletes what it cannot attribute; leave that opt-out off for preservation. A hold does not block reads or edits, and SQL/independent module delete commands bypass it |
| The same preservation request without enterprise holds | OSS, once the manual retention command ships | Record the preservation instruction outside the product; do not run the person's erasure or independent deletion. Pass repeatable `--exclude-subject <kind:id>` for every relevant held subject/identifier reference on each `mercato privacy retention` run. An unsupported kind refuses the set rather than guaranteeing selective preservation. With no guard, omitting exclusions leaves no protection. Clear the form's retention period wherever it could anonymize this subject, and pause any retention process that cannot honour the preservation instruction |
| "I object to marketing" | OSS, once E2 / the 10-22 contact-permissions design ships | Set the scoped person/address-purpose suppression/permission controls. Until then record the objection outside the product and stop affected outreach manually. The proposed sender policy does not govern external mail clients or every provider |
| "I contest accuracy" or "I object" | OSS export once the contract ships; manual controls in either edition | Export through an authorized request if needed. Instruct staff: do not edit except to rectify at the person's request under a documented lawful exception; stop ordinary reads, reporting, automation and disclosure for that person by controller procedures. Record permitted exceptions and instruct downstream operators. The product does not enforce these instructions per record |
| Telling recipients (Art. 19) | Manual in both editions | The product has no per-subject disclosure register. The [register draft](../../GDPR/2026-11-16-privacy-ropa-generator.md#declarations) lists active recipients and cannot establish who received this person's data. Review available integration execution records, webhook delivery logs, provider records and manual correspondence to reconstruct actual disclosures; those sources may lack subject linkage or already have expired. Notify the identified recipients and record any impossible/disproportionate-effort assessment; do not mark the step complete merely because the active-recipient list was checked |

Before ordinary processing resumes, the controller assesses whether the stated ground has ended, records the lawful basis and authorized exceptions, and tells the person before lifting the manual restriction (Art. 18(3)). Record that notice and the authorized resumption time in the controller's case record; a hold release alone does not authorize renewed processing.

### Known limits

- The product has no technical restriction of processing for an individual record. A legal hold preserves data; contact permissions suppress specified outreach; neither is a general use restriction.
- **R3-5 — Holds, honestly.** Legal holds exist only with the enterprise engine. They stop the subject erase run and protect retention sets through the optional `privacyRetentionGuard` (DEC-C, record-retention spec, "Legal holds"). Forms retention consults that guard before anonymizing: it excludes held subjects or skips the run as `hold_not_honourable`; without the guard it runs as specified (forms-retention spec, R3-5). OSS has only the record-retention command's repeatable `--exclude-subject <kind:id>`; it has no legal-hold mechanism. An OSS operator must pass the exclusion on every applicable run, clear the form's retention period when it could anonymize the subject, and not run erasure. Operational pruners apply expiry or age to tokens and logs, rather than resolving subjects; legal holds do not apply to them or to access-log rotation. A controller needing to preserve those records must separately disable the relevant prune or preserve an authorized copy under its own procedure.
- An unmatched hold can defer a whole tenant's set. `allowUnmatchedHolds` weakens that preservation for a specific record policy, and is not a restriction mechanism.
- No complete subject-specific disclosure history exists. Active recipients and retained delivery logs are leads for a controller's reconstruction, not proof of complete notification.

These same limits belong on the deployment docs page and in the program's Known limits. This spec edits neither destination; they are listed under Needed elsewhere in the revision report. Option A adds no runtime code. The deployment-docs spec owns `restriction-and-objection`: Stage 1 publishes the Option A procedure (DEC-8) with the factual current-release limits and no enterprise prerequisite; steps that depend on an unshipped hold or command are labelled unavailable until it ships; Stage 3 adds shipped erase/retention/hold instructions. `data-subject-requests` links to that page. Planned controls are labelled unavailable until their own release.

## 📝 Option B — requirements, if a record freeze is built

DEC-8 rejects a freeze for this program. A freeze must not be presented as restriction. If a later spec builds one, the first design's review sets these requirements:

1. **Name and wording.** "Frozen record". The banner and the settings page state what is and is not blocked.
2. **Where the block sits.** In the `customers` module, which asks an optional guard. Checked where the person is already loaded by the module's shared command helpers, not from an untyped input; with a resolver for each command that carries only a child's id.
3. **Coverage.** Every `customers` command, including tags, labels, roles, company links and conversation shares; `beforeUndo` as well as `beforeExecute`. Writes outside commands — the two link handlers and the projection — are either guarded or listed on the banner as not blocked.
4. **Refusal.** A 409 with a code. Not 423.
5. **Overrides.** A recorded, per-operation override for the Art. 18(2) exceptions, instead of lifting the freeze.
6. **Lifting.** A separate feature, and a required acknowledgement that the person has been informed (Art. 18(3)).
7. **Recipients.** A manual disclosure reconstruction/notification step as in Option A. The active-recipient register cannot prove actual disclosures for the subject (Art. 19).
8. **Visibility.** A response enricher on the person, gated on the ordinary people-view feature, so that everyone who opens the record sees the freeze; the host page honours it. That is an OSS change.
9. **Email.** Only through the 10-22 spec's outbound-policy seam, when it exists. Nothing bespoke in the compose route.
10. **Cost and failure.** One lookup per request, cached; a stated answer to what happens to every CRM write when the freeze table cannot be read.
11. **Scope.** An organization column, so that one organization's administrators do not see another's frozen people.
12. **Other mechanisms.** A legal hold keeps its preservation meaning and does not start blocking edits. A separate freeze must block ordinary edits as processing while leaving specifically authorized rectification possible. Retention sets must honour declared exclusions; OSS has no enterprise hold service. A staff-user erasure that would clear ownership on a frozen person needs an explicit decision.

## 📝 Delta

Option A changes documentation only; no API or UI runtime behavior is added. Its acceptance scenarios are that an OSS operator finds a manual preservation fallback, an enterprise operator sees the tenant-wide skip and opt-out limit, and a controller is told to stop ordinary edits and reconstruct actual recipients. B/C are not built; a later spec would need its own runtime Delta.

## 📋 Implementation Plan and validation

1. Write and publish the deployment-doc `restriction-and-objection` procedure in Stage 1 (DEC-8), with the edition/availability table, the exact R3-5 Known limits and the factual current-release limits; label steps that depend on an unshipped hold or command as unavailable until it ships; Stage 3 adds only the controls shipped by then, and `data-subject-requests` links to it; verify links to the OSS commands, enterprise guard boundary and contact-permissions proposal against the implementation at that future merge.
2. Review three documentation scenarios: OSS preservation without holds including form-period removal and separate operational-log preservation, enterprise hold-aware forms and unmatched-hold behavior with and without the opt-out, and a contested record with permitted rectification and manual recipient reconstruction. Confirm that no instruction claims an active-recipient list proves disclosure history. A lifting scenario requires documented reassessment, advance notice and authorized resumption before ordinary processing restarts; releasing a hold alone is insufficient.
3. Validate Markdown tables locally. No runtime route or key UI path changes in A, so this document does not invent unit/integration implementation tests. The engine's TC-PRIVACY-GOV-001/003/004 cover its actual hold/ACL/retention paths with their own fixtures; E2 owns outreach integration coverage. Any B/C implementation must add unit and self-contained integration coverage for every enumerated read/write/sender path before shipping.

## 📝 Migration & Backward Compatibility

Option A is documentation only. It changes no API, schema, feature id, event, DI key or module boundary. B/C are rejected for this program (DEC-8). A later spec that builds either follows the `BACKWARD_COMPATIBILITY.md` protocol before narrowing frozen or stable behavior, including a minor-version bridge unless its PR carries the named maintainer approval for a qualifying Emergency Security Exception.

## 📝 Risks & Impact Review

#### A controller believes the product restricts processing
- **Scenario**: A person is told their data is no longer used, while reports and the assistant still read it.
- **Severity**: High
- **Affected area**: the controller's statement to a data subject
- **Mitigation**: Option A says plainly that there is no technical restriction. Option B's first requirement is that it is not called one.
- **Residual risk**: A controller who skips the page may still describe a legal hold or contact suppression as restriction. Any later option B banner that says "frozen" would carry the same risk.

#### The gap stays open
- **Scenario**: Nothing is built and a regulator asks how restriction is implemented.
- **Severity**: Medium
- **Affected area**: tenants subject to such a request
- **Mitigation**: DEC-8 records the choice and Known limits state it. Edition/availability is explicit; an enterprise hold and OSS export may be used only when deployed. Ordinary editing is processing and is stopped by instruction, with narrowly recorded exceptions. API-backed assistant tools and independent reads are both in the future restriction inventory.
- **Residual risk**: A procedure depends on people following it.

#### Preservation silently depends on the edition
- **Scenario**: An OSS operator follows a legal-hold instruction that their installation cannot perform, or an enterprise operator enables unmatched-hold deletion.
- **Severity**: High
- **Affected area**: preserved subject records and record-retention sets
- **Mitigation**: Separate OSS manual exclusions from enterprise guards; state whole-tenant skips and the explicit opt-out; pause unhonourable processes.
- **Residual risk**: Manual exclusions can be omitted, independent deletes/pruners remain outside the guard, and controllers must enforce the documented stop themselves.

#### The wrong recipients are notified
- **Scenario**: Staff treat all active recipients as the people who received the subject's data and miss an earlier recipient.
- **Severity**: Medium
- **Affected area**: controller recipient notification
- **Mitigation**: Explicitly state that no per-subject disclosure ledger exists; reconstruct from available integration/webhook/provider/manual records and record uncertainty.
- **Residual risk**: Expired or unlinked delivery records may prevent complete reconstruction; the procedure cannot manufacture missing evidence.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root/spec rules and backward-compatibility contract; current people-tool, command/undo, projection and sender code; relevant customer/shared/core/UI guidance. GDPR source is linked above. This is a documentation decision, not a technical compliance guarantee.

| Rule | Status | Notes |
|---|---|---|
| Product direction | Decided | Option A under program DEC-8; B/C would need a new approved spec, and none is planned |
| Accurate control boundaries | Designed | Edition/availability, preservation opt-out and absent disclosure ledger are explicit |
| Integration scope | Documentation only | No changed runtime path; related engine/E2 tests remain owned there |
| Enterprise scope in the enterprise specs directory | Compliant | Option B would touch OSS for the guard and the enricher, and says so |

**Verdict:** Approved as a decision record. Option A (program DEC-8) is implemented as G5's `restriction-and-objection` page, published in Stage 1; B/C are not implementation authority.

## Changelog

### 2026-11-16
- Written autonomously as a design for a restriction mark enforced by a command interceptor.
- Rewritten after independent review as a decision record. The review showed that blocking edits alone left reads, automation and disclosures open; ordinary edits also fall within processing under Arts. 4(2) and 18(2). It also showed that writes to a person also happen outside commands and through undo; that an injected widget cannot make a form read-only; that 423 already means something else; and that Arts. 18(3) and 19 were missing. The default is now a documented procedure with existing controls, and the requirements for a record freeze are kept for a later decision.
- Council round two fixes (GPT-6.1 Sol workers): r7-09 — edition-aware preservation, OSS exclusions and unmatched-hold limits; r7-33 — manual subject-disclosure reconstruction and known limit; r7-50 — API-backed assistant reads and remaining independent paths; g4-29 — editing is processing, rectification exceptions and corrected options/changelog.
- Council round two fixes, pass two (GPT-6.1 Sol workers): quote the program's exact R3-5 Known limits; add hold-aware forms, OSS form-period removal and separate operational-log preservation; align the deployment-doc page and staged availability, retain the direction gate and add manual advance-notice/lifting instructions. The corrected rationale remains that editing is processing and edit blocking alone omits other uses.
- Council round two fixes, pass three (GPT-6.1 Sol workers): verify the program's exact R3-5 Known limits, C3 hold/skip/exclusion boundaries, the register's recipient limits and the contact-permissions seam against their merged carriers. Option A retains DEC-8/Q1 approval; the deployment-doc carrier still needs to distinguish factual Stage 1 limits from publication of the gated procedure.
