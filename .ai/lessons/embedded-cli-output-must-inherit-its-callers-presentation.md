---
title: "Embedded CLI output must inherit its caller's presentation margin"
modules: ["create_app","cli"]
areas: ["debugging"]
topics: ["runtime-startup","testing"]
---

# Embedded CLI output must inherit its caller's presentation margin

**Context**: The create-app and `mercato agentic:init` wizards printed a three-space-indented skill-installation heading, then inherited the standalone skill installer's independently formatted output.

**Problem**: Inherited child output started at column zero, breaking the wizard's visual hierarchy. Hard-coding the margin in the child would also make direct `yarn install-skills` output unexpectedly indented.

**Rule**: When a CLI embeds another CLI's inherited output, pass presentation context explicitly and apply it uniformly to the child's stdout and stderr. Keep direct invocation formatting unchanged, and test the composed parent-child output with line-anchored assertions.

**Applies to**: `packages/create-app/src/setup/wizard.ts`, `packages/cli/src/lib/agentic-setup.ts`, and `packages/create-app/agentic/shared/scripts/install-skills.mjs`.
