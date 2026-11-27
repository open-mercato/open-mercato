# Setup terminal log icons

## Goal

Make the setup notices in the terminal visually consistent with the progress steps by giving each notice a relevant icon.

## Scope

Update the service-mode announcement, successful connection checks, environment-file notices, and successful encryption preflight status in the starter and standalone template where each message is used.

## Implementation Plan

### Phase 1: Terminal output

1. Replace the selected setup prefixes and preserve how routine environment messages are filtered from failure summaries.
2. Verify the output in starter and standalone fixtures and check template parity.

## Risks

Low risk. The compact log classifier recognizes the environment-file notice by its prefix, so the classifier and regression coverage need to change alongside the notice.

## Progress

PR: #10477

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Terminal output

- [x] 1.1 Add icons to setup notices and preserve log filtering — e9a7f435d3
- [x] 1.2 Verify terminal output and template parity — e9a7f435d3
