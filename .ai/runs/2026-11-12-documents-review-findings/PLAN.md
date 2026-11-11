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
| 1.2 | Review content + anchoring libs with unit tests | todo | |
| 1.3 | Finding commands (ingest/apply/keep/reopen), events, summary, undo | todo | |
| 1.4 | Findings API routes | todo | |
| 1.5 | Phase 1 integration tests | todo | |
| 2.1 | Changes tab, cards, findings hook | todo | |
| 2.2 | Decorations, apply/keep/reopen UI, outline dots, i18n | todo | |
| 2.3 | Phase 2 integration tests + DS guardian | todo | |
| 3.1 | Playbook/rule/reference entities, commands, CRUD routes, ACL | todo | |
| 3.2 | Playbook admin pages, ingest rule resolution | todo | |
| 3.3 | Phase 3 integration tests | todo | |
| 4.1 | AI tools, agent contract, workflows.ts registration, peer dep | todo | |
| 4.2 | UPDATE_ENTITY array interpolation spike + docs page | todo | |
| 4.3 | Phase 4 integration test | todo | |
| 5.1 | Full validation gate, draft PR | todo | |
