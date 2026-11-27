# Harden the scaffold test's toolchain diagnostic

## Goal

Resolve the CodeQL finding in the CLI scaffold design-system contract test while preserving the TypeScript resolution details written when ESLint fails to run.

Source doc: .ai/specs/2026-07-05-ds-module-ui-scaffold.md

## Scope

The diagnostic subprocess, its regression coverage, and validation of the scaffold design-system contract. The command-line interface, generated module files, dependency versions, and CI configuration are outside this change.

## Implementation Plan

### Phase 1: Test diagnostic

1. Run the toolchain diagnostic from a static script and pass the resolution directory as a process argument.
2. Exercise the diagnostic with a temporary resolution directory containing path punctuation. Run the scaffold contract suite and verify that the previous dynamically built evaluation path has been removed.

## Risks

The diagnostic must resolve TypeScript from the same directory used by ESLint's parser and preserve its version and API information. The remediation is test-only.

## Progress

PR: #10960

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test diagnostic

- [x] 1.1 Run the static toolchain diagnostic — 97526498340e414265a25d8bbf33d2bce76dd213
- [x] 1.2 Prove diagnostic and scaffold behavior — 97526498340e414265a25d8bbf33d2bce76dd213
