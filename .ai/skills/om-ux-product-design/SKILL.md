---
name: om-ux-product-design
description: "Evidence-first UX decision system for Open Mercato — the umbrella over om-ux-heuristics and om-ux-copy. Use when asked to 'design this flow', 'review the UX', 'is this good UX', 'which pattern should we use', 'audit this screen', 'plan a usability test', or whenever a UX recommendation must be justified, weighed, and made testable. Triggers on 'UX decision', 'evidence', 'pattern selection', 'state matrix', 'accessibility criteria', 'UX audit', 'design review', 'ocena UX'. Governs UX decisions ABOVE the DS layer (tokens/primitives are om-ds-guardian's); its findings land in mockup documents as evidence-tagged finding annotations."
---

# UX Product Design — the Evidence-First Decision System

A UX skill is a repeatable **decision system**, not tips about colors and buttons. A good UX decision (1) understands the user and their task, (2) detects problems, (3) selects a proven pattern, (4) designs the whole flow and all states, (5) checks accessibility, (6) proposes a test, and (7) defines how we know it works. The prime rule, applied without exception:

> **EVIDENCE FIRST, AESTHETICS SECOND.**

Never recommend a change because it looks more modern. Every recommendation carries its evidence level, its tradeoff, and an acceptance criterion — or it is not a recommendation, it is an opinion.

## Where this skill sits in the repo

- **Above the DS layer.** Tokens, primitives, semantic colors, typography, and component-level compliance are governed by `om-ds-guardian` — this skill never re-litigates them. This skill governs the layer above: task fit, flow design, pattern selection, state coverage, content, and accessibility *decisions*. Boundary rule: "which component variant exists and how it is styled" → guardian; "whether this screen lets the user complete the task" → this skill.
- **Executable arm:** `om-ux-flows` productizes steps 1-2 below (define the problem, map the critical path) as a validated flow outline (`*.flow.json`, schema `packages/core/src/modules/design_system/mockups/flow.ts`) that drives draft mockup generation; `om-ux-heuristics` runs this system's audit against `*.mockup.json` documents and writes the results INTO the document as `finding` annotations (schema `packages/core/src/modules/design_system/mockups/schema.ts`); `om-ux-copy` applies the content-design rules to microcopy. Audits of **live screens** use the same process and the same severity/evidence vocabulary; pre-implementation findings go to the mockup, post-implementation observations go to the synthetic-user walkthrough pipeline (`.ai/specs/2026-07-07-ux-synthetic-user-walkthroughs.md`).
- **Severity mapping** (this skill's weights → the composer's `finding.severity`): BLOCKER → `critical`, MAJOR → `high`, MODERATE → `medium`, MINOR → `low`.
- **Evidence mapping**: the tags below are the `finding.evidence` enum (`product | standard | platform | research | heuristic | assumption`), rendered in the mockup ledger as an uppercase tag beside the severity dot; assumption-tagged findings are counted separately in the ledger header because **assumptions demand verification**.

## The evidence hierarchy (conflict-resolution order)

When sources disagree, the higher level wins. Tag every claim:

1. **[PRODUCT]** — product-specific research and data: user observation, support tickets, analytics, session recordings. Strongest, because it is about *these* users doing *this* task.
2. **[STANDARD]** — accessibility standards and requirements: WCAG, platform semantics. Non-negotiable floors, not preferences.
3. **[PLATFORM]** — platform conventions: web/desktop/touch behaviors, Apple HIG, Material 3. Users arrive trained by the platform.
4. **[RESEARCH]** — verified pattern libraries: GOV.UK Design System, Baymard, NN/g. Tested patterns, mind the original context.
5. **[HEURISTIC]** — heuristics and cognitive psychology: Nielsen's 10, Laws of UX. Useful lenses, weakest positive evidence.
6. Visual inspiration (Dribbble/Behance/Awwwards) comes **LAST** and never outranks anything above — a pretty screen with unknown results is not evidence.

Plus **[ASSUMPTION]** — a claim requiring verification. Assumptions are legitimate and often necessary; *presenting* an assumption as research is the cardinal sin. Record it, tag it, and put its verification in the test plan.

Annotated source library with links and caveats: [`references/sources.md`](references/sources.md).

## The 8-step process

1. **Define the problem.** User/segment, main task, expected outcome, context of use, platform, technical and business constraints, risk level, available research/data, success metric. Missing information → record explicit [ASSUMPTION]s, never silently fill gaps.
2. **Map the critical path.** Entry point, decisions and actions along the way, moments where data is required, potential error points, the completion moment, and the next step after success.
3. **Audit.** Goal clarity, information architecture, status visibility, consistency, cognitive load, control/undo, error prevention, forms and messages, accessibility, trust, content, responsiveness.
4. **Weigh the problems.** BLOCKER (the task cannot be completed) / MAJOR (high risk of error, abandonment, or exclusion) / MODERATE (noticeable slowdown or confusion) / MINOR (local or cosmetic). Weight = **impact × frequency × reach — never taste.**
5. **Select patterns.** Per solution: the problem, the recommended pattern, why it fits *this* context, evidence level and source, an alternative, tradeoffs, and when NOT to use it. Record reusable decisions as pattern cards ([`references/pattern-card-template.yaml`](references/pattern-card-template.yaml)) — a card captures WHY/WHEN/UNDER WHAT CONDITIONS, not just how it looks.
6. **Design all states.** The complete state matrix ([`references/state-matrix.md`](references/state-matrix.md)) — reject happy-path-only designs.
7. **Check accessibility** (below) — as part of the pattern, not a final audit stage.
8. **Propose validation.** Key hypotheses, test tasks, the right participants, qualitative + quantitative data, and the decision conditions (what result changes what).

## Required response format for a full UX engagement

1. Context & assumptions · 2. Main user task · 3. Critical path · 4. Problems by weight · 5. Recommended patterns · 6. Alternatives & tradeoffs · 7. State matrix · 8. Content recommendations · 9. Accessibility criteria · 10. Acceptance criteria · 11. Test plan · 12. Success metrics.

For a mockup audit the artifact IS the response — findings in the document, sections 1-3 and 11-12 summarized to the reviewer.

## Single-recommendation format — the mandatory quad

Every recommendation, down to a one-liner, carries **evidence → pattern → tradeoff → acceptance criterion**. Full form: Problem / User impact / Weight / Evidence level / Recommendation / Rationale / Alternative / Tradeoff / Acceptance criteria / How to measure.

Example transformation — never this:

> "The button should be bigger."

Always this:

> "The primary action competes visually with three secondary actions. Use one clear primary action and demote the rest. Based on consistency + minimalism heuristics [HEURISTIC]; verify with a task test. Success: the user identifies the correct action unprompted and completes the task without backtracking."

## Design patterns this skill enforces

- **User task before screen.** Who performs the task, the desired outcome, the context, the obstacles, what happens before and after — only then pick the screen, component, or flow.
- **System status visibility** (Nielsen #1). After every significant action the user knows: was it accepted? is it processing? is it saved? what happens next? is it safe to close?
- **Control and undo.** Prefer Undo over confirmation dialogs; preserve entered data after errors; make processes cancellable; make going back easy; mark irreversible actions clearly; reserve extra confirmation for truly risky actions.
- **Error prevention before error handling.** Suggest formats, use proper field types and keyboards, support autofill, hide or block disallowed options, make consequences clear, offer review before final submit.
- **Forms and validation.** Persistent labels (a placeholder is never the only label); ask only for needed data; user language; specific error messages (what is wrong AND how to fix it); point at the field; preserve typed data; logical focus order; an error summary for long forms; a review screen before irreversible transactions (GOV.UK validation and error-summary patterns).
- **Recognition over recall.** Visible options, labels, sample data, recent values, contextual hints, clear steps, consistent naming and placement; never require remembering information from a previous screen.
- **Progressive disclosure.** Show what the current task needs; advanced options later or on demand. Never hide key costs, conditions, consequences, or essential functions.
- **Complete state matrix.** Initial, loading, empty, no results, partial, validation error, system error, offline, permission denied, success, destructive action (+ recovery). Full table with per-state requirements: [`references/state-matrix.md`](references/state-matrix.md).
- **Content design.** The heading says what the user can do; the button names the action (never a bare "OK"); messages never blame the user; consistent naming across screens; instruction before the moment it is needed; language understandable without domain knowledge; the most important information first (GOV.UK content design). Executable in `om-ux-copy`.

## Accessibility — part of the pattern, never an end-stage audit

Baseline WCAG 2.2; WAI-ARIA APG for custom controls — and **bad ARIA is worse than native**: prefer semantic HTML and native elements first. Check: keyboard operability, visible focus, logical focus order, accessible names, contrast, never color-only meaning, touch target size, zoom and text scaling, reduced motion, dynamic announcements. In mockup audits, flag the markers observable in a document (icon-only actions without names, color-only status, missing labels); the rest become acceptance criteria for the implementation.

## Platform conventions

- **iOS** → Apple HIG; **Android** → Material 3; **web** → standard browser behaviors (back button, links, scrolling, form semantics); **desktop** → keyboard, shortcuts, denser UIs; **mobile** → touch targets, smaller viewport, interruptions.
- Open Mercato's backoffice is a **desktop-first web product**: honor browser behaviors and the keyboard contract (dialogs honor Escape / Cmd+Enter), design information density for work, and verify tablet/mobile presets deliberately (mockup `width` presets exist for this).
- Never copy a pattern across platforms blindly — a bottom sheet is not a dropdown, a HIG convention is not a web convention.

## AI products module

Open Mercato ships AI surfaces (`packages/ui/src/ai/` — `AiChat`, `AiDock`, `AiAssistantLauncher`, `ModelPicker`; module-level agents via `ai-agents.ts`). When designing or auditing them (per the Google PAIR Guidebook):

- State clearly what the AI can and cannot do; never mislead about confidence.
- Let the user correct and edit results; make retry/refine easy.
- Keep human control before high-consequence actions; provide a safe fallback when the AI fails.
- Explain sources where the answer depends on them.
- Design for wrong, incomplete, and ambiguous outputs — they are states in the matrix, not edge cases.
- Collect feedback without interrupting the task.

## Hard rules

- **Never invent user quotes, research, or data.** Never present generated personas or AI-written quotes as real research.
- **Never present an assumption as research** — tag it [ASSUMPTION] and schedule its verification.
- Never assume a popular pattern fits every context; never copy platform patterns across platforms blindly.
- Never design only the happy path. Never treat accessibility as a final checklist.
- Never recommend a change only because it looks more modern.
- Never hide costs, limitations, or consequences.
- Keep human control for risky actions.

## Anti-pattern blocklist

Block these outright — full list with detection notes and fixes in [`references/anti-patterns.md`](references/anti-patterns.md):

placeholder as the only label · error without how-to-fix · wiping data after an error · vague buttons (OK/Next/Send) when the action can be named · disabled button without explaining the missing condition · unlabeled icons with non-universal meaning · auto-executing important actions silently · hiding price/fees/consequences · forced registration without justification · status by color alone · happy-path-only design · copying pretty screens without knowing their results · fake personas or quotes as research.

In mockup audits, the statically decidable ones run as mechanical checks in `mockups/heuristics.ts` (see `om-ux-heuristics`); the rest are judgment checks with the same finding vocabulary.

## Workflow summary

1. Asked for a UX decision or review → run the 8-step process; scale the response format to the question (the quad is the floor, the 12 sections the ceiling).
2. Auditing a mockup → hand the audit execution to `om-ux-heuristics` (findings, severities, evidence tags into the document); writing/reviewing copy → `om-ux-copy`.
3. Every artifact you leave behind — finding, recommendation, pattern card — must let a stranger see the evidence, the tradeoff, and the acceptance criterion without asking you.
