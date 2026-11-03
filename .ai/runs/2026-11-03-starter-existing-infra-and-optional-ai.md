# Starter: optional AI and reusable existing infrastructure

## Goal
Let setup proceed without an LLM key and reuse the matching Mercato infrastructure started by earlier tooling instead of treating it as foreign port owners.

## Scope and non-goals
Starter provider prompt, Compose discovery/read-only adoption, actionable port-conflict guidance, regression tests and related docs/spec. Diagnose the bootstrap module-facts warnings; change only a proven bootstrap logging defect if it is small and covered. Doctor was confirmed working by the operator and stays unchanged. Never kill unrelated processes or delete volumes. Automatic stop versus guidance is awaiting operator clarification.

## Implementation plan
1. Make AI provider configuration optional with an interactive skip and non-interactive continuation; keep existing configured-provider synchronization.
2. Discover and verify existing matching Mercato containers across Compose project identity changes, reuse healthy services, retain readiness checks and diagnose incompatible/foreign owners.
3. Verify meaningful regressions and real read-only discovery on an already-running stack; apply appropriate validation and automated review.

## Risks
A container name or open port alone cannot establish compatible ownership. Preserve existing secrets, mounts and database credentials; do not automatically repoint services or stop another project's stack. Runtime migrations are not part of test execution without approval.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implementation

- [ ] 1.1 Make the provider step optional and add regression coverage.
- [ ] 1.2 Discover and reuse existing Mercato infrastructure with regression coverage.
- [ ] 1.3 Resolve port guidance and module-facts warning diagnosis; update docs/spec.

### Phase 2: Verification and publication

- [ ] 2.1 Run relevant validation and real read-only discovery checks.
- [ ] 2.2 Run authoritative review and publish the completed PR.
