# Create-app skill message indentation

## Goal

Make the skill-installation messages emitted during `create-mercato-app` agentic setup use the same three-space indentation as the surrounding wizard output.

## Scope

- Add a regression assertion for the default standalone skill-installer summary.
- Indent standalone installer output only when it is embedded by create-app or `mercato agentic:init`, including success and failure messages.
- Preserve all message wording, install behavior, flags, and direct invocation semantics.

## Non-goals

- Rewording or reorganizing the agentic setup summary.
- Changing skill selection, installation, external downloads, or agent link layout.
- Changing monorepo shell installer output or unrelated create-app prompts.

## Implementation Plan

### Phase 1: Regression repair

1. Add a regression oracle that requires every default standalone skill-installer summary line to start with the wizard's three-space indentation.
2. Apply the minimal indentation fix to the default standalone skill-installer summary.

### Phase 2: Verification and delivery

1. Run the focused create-app tests and the configured full validation gate.
2. Run the authoritative automated PR review/autofix pass and finalize the PR metadata and summary.

## Risks

- Tests or downstream scripts may match the exact console text. The wording remains unchanged, and the regression test limits the intended delta to leading whitespace.
- The bundled installer is also used by `mercato agentic:init`; consistent indentation is desirable there because its surrounding setup output uses the same three-space convention.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Regression repair

- [ ] 1.1 Add a regression oracle that requires every default standalone skill-installer summary line to start with the wizard's three-space indentation.
- [ ] 1.2 Apply the minimal indentation fix to the default standalone skill-installer summary.

### Phase 2: Verification and delivery

- [ ] 2.1 Run the focused create-app tests and the configured full validation gate.
- [ ] 2.2 Run the authoritative automated PR review/autofix pass and finalize the PR metadata and summary.
