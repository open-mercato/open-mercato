---
title: "Configuration suggestions must reflect runtime capabilities"
modules: ["agent_orchestrator", "ui"]
areas: ["backend-ui", "testing"]
topics: ["ui-components", "validation-errors", "testing"]
---

# Configuration suggestions must reflect runtime capabilities

**Context**: The process-definition form asked operators to invent milestone keys and immediately warned about newly added blank rows. Merely collapsing technical fields did not help them choose valid progress checkpoints.

**Rule**: Start with the user's intended outcome and suggest values backed by the selected resource's actual capabilities. A workflow milestone must come from a declared emission, not an arbitrary step name. Keep custom entries as explicit local drafts, distinguish missing metadata from request failure, and preserve existing selections when context changes. Search fragments must not become grants or configuration values just because an input loses focus.

**Verification**: Cover suggestion selection, label/key independence, empty capabilities, failed lookup/retry, stale responses, and explicit draft commitment. Inspect the rendered form and save a self-contained fixture through the real API.

**Layout follow-up**: Before limiting a configuration form's width, inspect CrudForm's existing group-column support. Use its responsive main/sidebar layout for complex setup pages; verify wide desktop as well as mobile so readable inputs do not leave most of the workspace unused.

**Consistency follow-up**: Keep question-based guidance in standard section titles when neighboring application forms use normal cards; do not turn the entire form into an accordion. Multi-line picker suggestions need content-sized rows and bounded scrolling. Verify that label and description bounds fit inside each option at narrow widths, not just that the page has no horizontal overflow.
