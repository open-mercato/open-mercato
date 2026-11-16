# Restriction of processing and objection: what the product can and cannot do

> **Program:** package C10 of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Proposed by the program; it is not in the issue, and the program says it needs a maintainer's yes before it is designed.
> **Status: direction not settled.** A first design — a mark that blocks edits — was judged by its reviewer to stop the wrong thing. This document records why, what an honest feature would have to do, and what a controller can do today without one.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person.

Extends: .ai/specs/enterprise/2026-11-16-privacy-dsr-engine.md

## 📝 TLDR

A person may ask a controller to stop using their data while a dispute is settled. Under GDPR Art. 18 the data may then be stored, and otherwise used only with their consent, for legal claims, to protect someone else, or for an important public interest. That is a rule about *use*. The product has no single place where use of a CRM person could be stopped: the record is read by lists, search, the assistant, dashboards and raw analytics queries, changed by code that does not go through commands, and announced to workflows, rules, webhooks and agents on every change. A mark that only blocks edits would stop the one thing the law does not ask to be stopped and leave the rest. **Proposed:** do not build a "restricted" flag now. Document the procedure a controller follows with what exists — a legal hold to stop erasure, contact permissions to stop outreach, an export to answer the person — and keep the requirements below for when someone decides to build the real thing.

## 📝 Open question for a person

**Q1. Record "no technical restriction; a documented procedure" as the program's position, or build a record freeze?**

| Option | What the controller gets | Cost |
|---|---|---|
| A. Procedure only | A documented way to handle a restriction or objection with existing controls, and a plain statement of what the product does not do | A docs page |
| B. Record freeze | A mark that refuses edits, deletes and erasure of one CRM person and shows a banner. It must not be called restriction | The requirements below, in two editions and five modules |
| C. Real restriction | Use is stopped: reads, the assistant, reports, outbound events | Every read path of the CRM consults the mark; not estimated |

Recommended: **A**. Option B is cheaper than C and easier to misread than either.

## 📝 What the law asks

- **Art. 18(1)**: restriction when accuracy is contested, when processing is unlawful and the person prefers restriction to erasure, when the controller no longer needs the data and the person needs it for a legal claim, or while an objection is assessed.
- **Art. 18(2)**: restricted data may be stored. Any other use needs the person's consent, or is for legal claims, the protection of another person, or important public interest.
- **Art. 18(3)**: the person must be told before the restriction is lifted.
- **Art. 19**: recipients the data was disclosed to must be told of the restriction, unless that is impossible or disproportionate.
- **Art. 21**: a general objection must be honoured unless the controller shows compelling grounds; an objection to direct marketing must always be honoured.

## 📝 What the code allows

**Reads have no common path.** The people list goes through `makeCrudRoute` and the query engine (`customers/api/people/route.ts:85-95`). The assistant's tools call the decrypting finder directly (`customers/ai-tools/people-pack.ts:90, 111, 169`). A dashboard widget uses the ORM (`customers/api/dashboard/widgets/new-customers/route.ts:70`). Analytics reads the table by name (`customers/analytics.ts:5-20`).

**Writes do not all go through commands.**

- Inbound and sent email create interactions by the ORM (`customers/lib/link-channel-message-handler.ts:514-548`).
- Workflow tasks persist links the same way (`lib/link-workflow-task-handler.ts:118-127`).
- The next-interaction projection updates the person by a raw query (`lib/interactionProjection.ts:64, 78`).
- Attachments, sales and phone calls write data tied to a person in their own modules.

**Commands can be refused, with gaps.**

- A command interceptor's `beforeExecute` can refuse, for requests, workers, workflows and the assistant (`packages/shared/src/lib/commands/command-bus.ts:312-319`). It receives the command's input, untyped; for a comment, an address or a task that is only the child's id.
- Undo runs different hooks, `beforeUndo`, with the log entry and not the input (`command-bus.ts:597`). Atomic replays skip interceptors (`:288`).
- An interceptor that declares features is skipped for users who lack them.

**Outbound.** The CRM compose route takes raw addresses, not person ids (`customers/api/people/[id]/emails/route.ts:31-33`). Other modules send mail too. The 10-22 spec's planned seam is a registered outbound policy that denies with its own code; it is not built.

**Screens.** A form's read-only state is a property of the host page (`packages/ui/src/backend/CrudForm.tsx:457`); an injected widget can show a banner and refuse a save, and cannot make a form read-only. The person page also edits through tabs and a sidebar that are not that form.

**Status codes.** 423 already means "locked by another editor" to the record-locks and cart modules and to at least one screen.

## 📝 Option A — the procedure

A page in the deployment docs, "Restriction and objection", that says:

| Request | What to do with what exists |
|---|---|
| "Do not erase; I need it for a claim" (Art. 18(1)(b), (c)) | Place a legal hold on the person in the governance module. Erasure and retention then refuse |
| "I object to marketing" (Art. 21(2)) | Set the contact permissions of the 10-22 spec once it ships. Until then, the controller records the objection outside the product |
| "I contest the accuracy" or "I object" (Art. 18(1)(a), (d)) | Export the person's data for them; correct what is wrong; while the matter is open, the controller instructs staff. The product does not stop reads, the assistant, reports or automation for that person |
| Telling recipients (Art. 19) | The register draft lists the recipients active for the organization |

And, in the same words on the page and in the program's list of known limits: *the product has no technical restriction of processing for an individual record.*

No code changes. The page ships with the deployment docs' data-subject-requests stage.

## 📝 Option B — requirements, if a record freeze is built

A freeze must not be presented as restriction. If it is built, the first design's review sets these requirements:

1. **Name and wording.** "Frozen record". The banner and the settings page state what is and is not blocked.
2. **Where the block sits.** In the `customers` module, which asks an optional guard. Checked where the person is already loaded by the module's shared command helpers, not from an untyped input; with a resolver for each command that carries only a child's id.
3. **Coverage.** Every `customers` command, including tags, labels, roles, company links and conversation shares; `beforeUndo` as well as `beforeExecute`. Writes outside commands — the two link handlers and the projection — are either guarded or listed on the banner as not blocked.
4. **Refusal.** A 409 with a code. Not 423.
5. **Overrides.** A recorded, per-operation override for the Art. 18(2) exceptions, instead of lifting the freeze.
6. **Lifting.** A separate feature, and a required acknowledgement that the person has been informed (Art. 18(3)).
7. **Recipients.** A documented step, fed by the register draft (Art. 19).
8. **Visibility.** A response enricher on the person, gated on the ordinary people-view feature, so that everyone who opens the record sees the freeze; the host page honours it. That is an OSS change.
9. **Email.** Only through the 10-22 spec's outbound-policy seam, when it exists. Nothing bespoke in the compose route.
10. **Cost and failure.** One lookup per request, cached; a stated answer to what happens to every CRM write when the freeze table cannot be read.
11. **Scope.** An organization column, so that one organization's administrators do not see another's frozen people.
12. **Other mechanisms.** A legal hold keeps its meaning and does not start blocking edits; retention sets receive frozen subjects in their leave-out list; a staff user's erasure that would clear ownership on a frozen person is decided.

## 📝 Delta

None. Option A changes documentation only. Option B's Delta is written when it is chosen.

## 📝 Risks & Impact Review

#### A controller believes the product restricts processing
- **Scenario**: A person is told their data is no longer used, while reports and the assistant still read it.
- **Severity**: High
- **Affected area**: the controller's statement to a data subject
- **Mitigation**: Option A says plainly that there is no technical restriction. Option B's first requirement is that it is not called one.
- **Residual risk**: With option B, a banner that says "frozen" will still be read by some as "restricted".

#### The gap stays open
- **Scenario**: Nothing is built and a regulator asks how restriction is implemented.
- **Severity**: Medium
- **Affected area**: tenants subject to such a request
- **Mitigation**: The procedure, the legal hold and the export are real controls; the limit is documented.
- **Residual risk**: A procedure depends on people following it.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| Open questions resolved before design | Not met, deliberately | Q1 is the content of this document; the autonomous default is option A |
| Enterprise scope in the enterprise specs directory | Compliant | Option B would touch OSS for the guard and the enricher, and says so |

**Verdict:** not a design to implement. Option A needs only the docs page; options B and C wait for Q1.

## Changelog

### 2026-11-16
- Written autonomously as a design for a restriction mark enforced by a command interceptor.
- Rewritten after independent review as a decision record. The review showed the design stopped edits, which Art. 18 does not ask to be stopped, and left use untouched, which it does; that writes to a person also happen outside commands and through undo; that an injected widget cannot make a form read-only; that 423 already means something else; and that Arts. 18(3) and 19 were missing. The default is now a documented procedure with existing controls, and the requirements for a record freeze are kept for a later decision.
