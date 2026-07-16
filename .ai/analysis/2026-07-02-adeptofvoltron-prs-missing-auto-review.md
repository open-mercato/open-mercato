# adeptofvoltron PRs without an `auto-review-pr` pass

**Repo:** `open-mercato/open-mercato`
**Analysis date:** 2026-07-02
**Method:** Pulled all 183 PRs authored by `adeptofvoltron` (`gh pr list --author adeptofvoltron --state all`), fetched every issue/PR comment for each, and searched for the `auto-review-pr` skill's signature comments (`🤖 auto-review-pr started by ...` / `🤖 auto-review-pr completed: ...`). 161 of 183 PRs carry that marker. The 22 below do not.

## Summary

| Category | Count | Meaning |
|---|---|---|
| Merged/closed with a manual (human) review or merge, no automated pass | 14 | Bypassed `auto-review-pr` entirely — a human (`pkarw` or `pat-lewczuk`) reviewed and/or merged directly |
| Merged/closed with **no review record at all** | 6 | Merged/closed with an empty `reviews` array — no bot or human review visible on the PR |
| Still open, `review` label pending | 6 | Not yet picked up by `auto-review-pr` — may just be next in the queue, not a confirmed gap |

(Some PRs fall in both "manual" and "no review" buckets is not possible — each PR is listed once, in the "Merged/closed without auto-review-pr" table, with its actual reviewer/merger noted.)

## Merged or closed without an `auto-review-pr` pass (16)

| PR | Title | State | Merged/Closed | Reviewed by | Merged by |
|---|---|---|---|---|---|
| [#2140](https://github.com/open-mercato/open-mercato/pull/2140) | feat(skills): add om-help workflow navigator skill | MERGED | 2026-05-27 | pat-lewczuk (approved) | pat-lewczuk |
| [#2200](https://github.com/open-mercato/open-mercato/pull/2200) | fix(ai-assistant): AI chat sharing i18n + persisted notification title + owner-in-picker (#2097) | MERGED | 2026-05-28 | — none — | pkarw |
| [#2330](https://github.com/open-mercato/open-mercato/pull/2330) | fix(ui): open DatePicker on the selected value's month | MERGED | 2026-06-01 | — none — | pkarw |
| [#2386](https://github.com/open-mercato/open-mercato/pull/2386) | fix(workflows): replace time-bomb date literals in validators test (closes #2384) | CLOSED (not merged) | 2026-06-01 | — none — | — |
| [#2406](https://github.com/open-mercato/open-mercato/pull/2406) | fix(api_keys): add transactional mock to keys.route unit test | CLOSED (not merged) | 2026-06-02 | — none — | — |
| [#2417](https://github.com/open-mercato/open-mercato/pull/2417) | fix(audit_logs): make tenant-level org undo reachable via public undo API (#2398) | MERGED | 2026-06-02 | — none — | pkarw |
| [#2797](https://github.com/open-mercato/open-mercato/pull/2797) | security(inbox_ops): userHasFeature() fails open when required feature is empty (#2700) | CLOSED (not merged) | 2026-06-07 | — none — | — |
| [#2859](https://github.com/open-mercato/open-mercato/pull/2859) | fix(entities): validate multi-value custom fields element-by-element (#2650) | CLOSED (not merged) | 2026-06-08 | — none — | — |
| [#2998](https://github.com/open-mercato/open-mercato/pull/2998) | security(onboarding): rate-limit unauthenticated onboarding submissions (#2923) | MERGED | 2026-06-11 | — none — | pkarw |
| [#3063](https://github.com/open-mercato/open-mercato/pull/3063) | feat(create-app): collaborative proposal skills + installer skill-package selection | CLOSED (not merged) | 2026-06-15 | — none — | — |
| [#3325](https://github.com/open-mercato/open-mercato/pull/3325) | fix(sync_excel): replace hardcoded run status badge colors with StatusBadge (#3313) | MERGED | 2026-06-18 | — none — | pkarw |
| [#3336](https://github.com/open-mercato/open-mercato/pull/3336) | fix(integrations): replace hardcoded external-id status colors with status tokens (#3257) | MERGED | 2026-06-18 | pkarw (approved) | pkarw |
| [#3391](https://github.com/open-mercato/open-mercato/pull/3391) | fix(cli): copy om-integration-builder STANDALONE.md in agentic:init scaffolder | CLOSED (not merged) | 2026-06-19 | — none — | — |
| [#3542](https://github.com/open-mercato/open-mercato/pull/3542) | fix(ui): disable native HTML5 validation on CrudForm so zod errors surface (#3485) | CLOSED (not merged) | 2026-06-24 | — none — | — |
| [#3685](https://github.com/open-mercato/open-mercato/pull/3685) | docs(specs): ts-morph module fact-sheets (design only) | CLOSED (not merged) | 2026-06-27 | pat-lewczuk (approved) | — |
| [#3686](https://github.com/open-mercato/open-mercato/pull/3686) | docs(specs): create-app agentic skills restructure | MERGED | 2026-06-27 | pat-lewczuk (approved) | pat-lewczuk |

Notably, half of these (10 of 16) were merged or closed with **zero recorded review** of any kind — no bot, no human — just a direct merge/close by `pkarw`.

## Still open, awaiting review (6)

These currently carry the `review` pipeline label and simply haven't been picked up by `auto-review-pr` yet — not a confirmed gap, but flagged since they're stale-ish (all opened 2026-06-30, i.e. 2 days old as of this analysis).

| PR | Title | Labels |
|---|---|---|
| [#3705](https://github.com/open-mercato/open-mercato/pull/3705) | fix(ui): honor field-level readOnly in CrudForm inputs (#3704) | bug, review, needs-qa, priority-medium, risk-medium |
| [#3706](https://github.com/open-mercato/open-mercato/pull/3706) | fix(encryption): restore decrypted JSON columns to objects on entity load (#3672) | bug, review, needs-qa, priority-medium, risk-high |
| [#3707](https://github.com/open-mercato/open-mercato/pull/3707) | fix(customer_accounts): translate German customer portal roles UI strings (#3669) | bug, review, skip-qa, priority-low, risk-low |
| [#3710](https://github.com/open-mercato/open-mercato/pull/3710) | test(messages): add integration test for action commandId allowlist guard (#3670) | review, skip-qa, priority-low, risk-low, test |
| [#3711](https://github.com/open-mercato/open-mercato/pull/3711) | feat(customers): cache GET /api/customers/companies/[id] detail with reused crud tags (#3664) | feature, review, priority-low, performance, risk-medium |
| [#3712](https://github.com/open-mercato/open-mercato/pull/3712) | feat(customers): cache GET /api/customers/deals/[id] detail (#3665) | feature, review, priority-low, performance, risk-medium |

## Notes

- 161 of 183 (~88%) of adeptofvoltron's PRs did get an `auto-review-pr` pass, so the gap is a minority but non-trivial (~12%).
- The 10 zero-review merges (all merged directly by `pkarw`) are the most notable finding — `risk-high`/security-flavored ones worth a second look: [#2417](https://github.com/open-mercato/open-mercato/pull/2417) (audit_logs undo API) and [#2998](https://github.com/open-mercato/open-mercato/pull/2998) (onboarding rate-limiting) went in with no recorded review at all.
- The 6 still-open PRs are recent enough (2 days old) that this may just reflect normal queue lag rather than a process gap — worth re-checking in a few days.
