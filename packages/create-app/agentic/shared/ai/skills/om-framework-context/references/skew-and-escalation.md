# Skew and Escalation

Load this reference when context resolution is degraded or contradictory.

- **Fact/version mismatch:** rerun generation; do not use stale facts with newer source.
- **Duplicate module/package versions:** require an explicit package/version selected by app-root resolution; report all candidates.
- **No source:** use package `dist` plus declarations and state that source-level analysis is limited.
- **Missing package/module AGENTS:** continue with available app/snapshot/package rules and exact code; report the gap.
- **Rule contradiction:** apply concern precedence, verify versions, and stop if unresolved rather than blending instructions.
- **Framework change required:** propose upstream issue/PR with version/reproduction, or ask for eject after UMES/override rejection.
- **Network source needed:** ask explicitly; pin it to installed release/commit and keep it read-only.

Never copy a different monorepo checkout as if it were the installed contract.
