# Documents review findings — execution plan

Source spec: `.ai/specs/2026-11-11-documents-ai-review-findings.md`
Branch: `feat/documents-review-findings`
Validation runner: local (no compose `app` container running)

Goal: implement structured, text-anchored review findings in the Documents module (Apply / Keep as is decisions, review signal), tenant review playbooks, read-only AI tools, a reviewer agent contract, and workflow-safe ingest registration.

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| 0.1 | Spec + run folder | done | |
| 1.1 | Finding entity, validators, caps, migration | done | 523b1ddce3 |
| 1.2 | Review content + anchoring libs with unit tests | done | dca9ac331b |
| 1.3 | Finding commands (ingest/apply/keep/reopen), events, summary, undo | done | 9c555d1e8f |
| 1.4 | Findings API routes | done | 930f64b722 |
| 1.5 | Phase 1 integration tests (written; run blocked by env, see HANDOFF) | done | 3ec9c8063e |
| 2.1 | Changes tab, cards, findings hook | done | 18c423fc40 |
| 2.2 | Decorations, apply/keep/reopen UI, outline dots, i18n (server tweak 374dfff616) | done | 18c423fc40 |
| 2.3 | Phase 2 integration tests (written; run blocked by env, see HANDOFF) + DS guardian | done | a839f2534b |
| 3.1 | Playbook/rule/reference entities, commands, CRUD routes, ACL (+ ingest rule resolution, server side) | done | e67509452c |
| 3.2 | Playbook admin pages, review header playbook line, i18n (ingest resolution landed in 3.1) | done | 3b86637c0a |
| 3.3 | Phase 3 integration tests (written; run blocked by env, see HANDOFF) | done | 041dc9c3d2 |
| 4.1 | AI tools, agent contract, workflows.ts registration, peer dep | done | f7dc18c3b4 |
| 4.2 | UPDATE_ENTITY array interpolation spike (array preserved, no findingsJson) + docs page | done | (see git log) |
| 4.3 | Phase 4 integration test | todo | |
| 5.1 | Full validation gate, draft PR | todo | |
