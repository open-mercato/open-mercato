> **Repo-local override.** Adds Open Mercato's security hotspot checklist, review baseline, severity mapping, and spec-target cross-checks to the shared `om-auto-sec-report-pr` analysis passes.

## Step 3 — repository security knowledge (add)

- `securityChecklist` in `.ai/agentic.config.json` points at `.ai/security-checklist.md` — Open Mercato's hotspots (scope keys `organization_id` + `tenant_id`, `findWithDecryption`, `requireFeatures` / `acl.ts`, feature wildcards and organization-scope `__all__`, `clientBroadcast` / `portalBroadcast`, encryption maps, quote/shipment/return/payment races, `openApi` / `.strict()` / `pageSize` rules, `@open-mercato/*` shadowing). Apply it in Pass A and Pass B on top of the built-in checklist.
- Apply `.ai/review-checklist.md` only to the surfaces the unit touched, alongside the repo-specific security hotspots in Pass A and Pass B.

## Step 4 — Pass A severity (add)

When a finding comes from `.ai/review-checklist.md`, map that file's Critical / High / Medium / Low to blocker / major / minor / nit, as the repo's `om-code-review` extension does.

## Steps 4–5 — spec targets (add)

- A spec target is any `.md` under `.ai/specs/`, including `.ai/specs/enterprise/`.
- Also apply section 3 "Data Integrity & Security" of `.ai/skills/om-spec-writing/references/spec-checklist.md` and the compliance matrix in `.ai/skills/om-spec-writing/references/compliance-review.md`.
- Cross-check backward-compatibility risk against the contract surface categories in `BACKWARD_COMPATIBILITY.md` the way `om-pre-implement-spec` does, when the spec is about to be implemented.
