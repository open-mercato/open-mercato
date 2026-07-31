> **Repo-local override.** This folder extends the external `om-auto-implement-spec` skill installed from `open-mercato/skills`. Apply these standalone readiness and no-remote rules on top of the external workflow; do not install this file as a replacement skill.

# Standalone portability overrides — `om-auto-implement-spec`

Everything tracker-facing uses the operations and guards from `.ai/trackers/github.md`. Resolve an automatic base branch through **default-branch**; never assume `main` or `develop`.

## 1. Audit the resolved spec before choosing an engine

After resolving the spec and before creating implementation tasks, read `.ai/specs/SPEC-000-template.md` and `.ai/skills/om-implement-spec/references/phases-and-gates.md`, then run the complete readiness audit. The spec must be `Ready for implementation`, have no blocking open questions, map every requirement to an acceptance criterion/phase/self-contained test oracle, define every affected UI and API contract, and give every phase dependencies plus an observable exit gate. UI contracts must cite an installed reference and require the platform shell/components, shared API helpers, semantic tokens, and light/dark plus responsive state coverage.

An incomplete or `Draft` spec is not an engine plan. Stop implementation, report the missing readiness items, and route revision through `om-spec-writing`; never fill the gaps inside generated agent prompts.

## 2. Preserve phase dependencies in PR delivery

When a remote and tracker are available, keep the external PR workflow but seed its execution plan from the spec phases. Only the current unblocked phase may be in progress. Parallel agents may own independent slices inside that phase only, and each brief must name routed guides/skills, closest installed reference, canonical primitives, acceptance IDs, owned files, and a validation oracle. Invoke routed skills before delegation, including `om-backend-ui-design` for rendered surfaces. A phase advances only after its integration paths and exit gate pass.

Do not launch one agent per future module, mark blocked phases in progress, or treat generated files/typecheck as proof that a business slice is implemented.

## 3. No-remote fallback is local and phase-safe

Standalone apps commonly start without a Git remote. If the tracker operations cannot resolve a repository/remote, report that PR delivery is unavailable and invoke the local `.ai/skills/om-implement-spec/SKILL.md` against the resolved spec, phase-by-phase. Do not improvise the external PR engine locally, claim a PR exists, or collapse the whole spec into concurrent module scaffolding.
