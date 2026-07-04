---
name: om-spec-writing
description: Guide for creating high-quality specifications for {{PROJECT_NAME}}. Use when starting a new SPEC or reviewing specs against architectural standards.
---

# Spec Writing & Review

Design and review specifications (SPECs) against Open Mercato architecture and quality rules.

## When to use

- Starting a **new** SPEC — turn a feature idea into a phased, testable specification under `.ai/specs/`.
- Reviewing an existing spec against staff-engineer architectural standards before implementation.
- Not for implementing a spec — that is `om-implement-spec`; not for a pre-implementation BC audit — that is `om-pre-implement-spec`.

## What it contains

A skeleton-first authoring workflow (load context → skeleton + Open Questions → iterate → research → design → phase breakdown → checklist review), an Architectural Review output format, review heuristics, and a quick rule reference. Reusable template + checklist live under `references/`.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Authoring or reviewing a spec — full step-by-step procedure, review output format, heuristics, quick rules | [`instructions.md`](instructions.md) |
| Writing a new spec — the canonical section layout to fill in | [`references/spec-template.md`](references/spec-template.md) |
| Reviewing a spec — the pass/fail checklist (§3 encryption maps, §5 canonical mechanisms + DS) | [`references/spec-checklist.md`](references/spec-checklist.md) |
| Module conventions, Mandatory Module Mechanisms, Design System, Encryption maps | [`AGENTS.md`](../../../AGENTS.md) |

## Non-negotiables

- Skeleton first: write TLDR + 2-3 key sections, surface **Open Questions**, and **STOP** until the user answers — never draft the full spec in one pass.
- Every spec breaks work into **Phases** (stories) and **Steps** (testable tasks) and ends with the checklist review.
- Singular naming, FK-ids only (no cross-module ORM), mandatory `organization_id`, Zod-validated inputs, encryption maps for sensitive columns, and canonical framework primitives — no hand-rolled substitutes.
