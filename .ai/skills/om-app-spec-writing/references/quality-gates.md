# Quality gates — examples & methodology

Before/after tables and the cross-story impact methodology `om-app-spec-writing` applies while writing workflows (Phase 1) and user stories (Phase 2). Loaded on demand — the rules live in the skill body; this file shows the bar.

## Kill vague rules

| Vague | Why it's dangerous | Specific |
|-------|-------------------|----------|
| "Admin manages team" | What does "manage" mean? | "Admin invites by email, assigns a role. Cannot delete users." |
| "System tracks work in progress" | Who creates the data? | "The account owner creates the deal. The system counts deals in the qualified stage per org per month." |
| "Tiers are evaluated" | By whom, when, based on what? | "A monthly scheduled job compares the three KPIs against 4 threshold sets. A manager approves changes." |

## Kill vague ROI

| Vague ROI | Specific ROI |
|-----------|-------------|
| "The vendor benefits from the pipeline" | "Each active partner generates avg 5 qualified deals/month = 5 new prospects in the vendor's pipeline" |
| "The partner gets visibility" | "Top tier = 2x higher match score = estimated 3x more RFP invitations/quarter" |
| "Better governance" | "Automated tier review saves a manager 4h/week of manual spreadsheet work" |

If you can't quantify the ROI, the workflow might not be worth building.

## Kill happy-path-only stories

| Happy-path-only | Complete |
|----------------|----------|
| "Account owner submits an RFP response. Success: the manager sees it in the comparison table." | "Account owner submits an RFP response. **Happy:** the manager sees it in the comparison table, linked to case studies. **Alternate:** the owner saves a draft, resumes later — the draft is visible only to them. **Failure:** submission with missing required fields → inline validation, no submission. Submission after the deadline → rejected with a clear message, no partial state." |
| "Admin invites a colleague by email. Success: the colleague sets a password, sees the dashboard." | "Admin invites a colleague. **Happy:** the colleague receives the email, sets a password, sees their scoped dashboard within 24h. **Alternate:** the colleague already has an account in another org → merge prompt, not a duplicate. **Failure:** invalid email → rejected at the form. The colleague never clicks the link → the invite expires after 7 days, the admin sees a 'pending' status." |
| "System imports KPI data. Success: the dashboard updates." | "System imports KPI data. **Happy:** the dashboard updates within 1 minute. **Alternate:** partial import (some rows valid, some not) → valid rows imported, invalid rows listed in an error report, the admin notified. **Failure:** import file malformed → rejected entirely, previous data unchanged, the admin sees an error with line numbers." |

## Cross-story impact analysis — methodology

### Impact matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|-------|--------------|-----------------|--------|------------|
| _example:_ US-01 | Partner tier upgraded | US-04 (benefits recalc), US-07 (match score changes) | Benefits and match score must update atomically or the user sees stale data | Domain event `TierChanged` triggers downstream recalcs |
| _example:_ US-03 | Account owner leaves the organization | US-02 (deal count drops), US-05 (open deals orphaned) | Orphaned deals have no owner, metrics turn inaccurate | A reassignment workflow is required before removal completes |

### Conflict patterns to watch for

- **Race conditions:** two stories modify the same entity — which wins? (e.g., a manual tier override vs. an automated evaluation)
- **Cascade storms:** Story A triggers an event → Story B reacts → triggers an event → Story C reacts → an unbounded chain
- **Stale preconditions:** a story assumes state X, but another story changed it minutes ago (e.g., "user sees tier benefits" after a downgrade the cache hasn't caught up with)
- **Orphaned references:** a story deletes/archives an entity that other stories reference (e.g., removing a metric type that active tier rules depend on)
- **Timing gaps:** Story A and Story B are both correct individually, but the time between them creates an inconsistent window (e.g., the tier changed but notifications haven't sent — the user acts on stale info)

### If the impact matrix reveals

- **Missing stories** (e.g., "we need a reassignment workflow") → add them before proceeding
- **Contradictions** (e.g., two stories can't both be true) → resolve them, don't defer as open questions
- **Missing domain events** (e.g., no event connects Story A's state change to Story B's reaction) → add them to the domain model
