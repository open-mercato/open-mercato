# Implement internal CRM activities

Source doc: .ai/specs/2026-11-22-internal-crm-activities.md
Spec PR: #10404
Issue: #5935

## Goal

Create and manage native Calendar activities and tasks with an optional CRM link while preserving record history and organization scope.

## Scope

Customers interaction persistence, canonical API and commands, Calendar editor, native reads, and direct compatibility call sites. Email and legacy write adapters retain their parent requirements.

## Implementation Plan

### Phase 1: Scoped native interactions

1.1 Characterize current linked creation, canonical null rejection, and CRM projection updates before changing the runtime.
1.2 Add the nullable relation, scoped write and replay logic, and null-safe read and mapping paths. Exercise API, email, authorization, replay, and projection behavior.

### Phase 2: Calendar and Tasks

2.1 Make the Calendar picker optional and cover create, attach, clear, and global and CRM-scoped Tasks behavior.
2.2 Run local validation and independent review, capture browser evidence when available, and archive the capability Delta.

## Risks

An unlinked row must always use an authorized tenant and organization. Email needs its real primary relation for sharing and deduplication. Replays must refresh each affected CRM projection without losing the interaction id.

## Progress

PR: #10405

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scoped native interactions

- [x] 1.1 Characterize current linked creation, canonical null rejection, and CRM projection updates — 609190425e
- [ ] 1.2 Add nullable persistence and scoped interaction lifecycle and reads

### Phase 2: Calendar and Tasks

- [ ] 2.1 Make the Calendar picker optional and cover the browser workflow
- [ ] 2.2 Run validation and review and archive the capability Delta
