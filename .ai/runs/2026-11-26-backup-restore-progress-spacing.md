# Align database backup and restore terminal output

## Goal

Start the restore title at the top of the output and align its headings and messages with the Overall progress row at the left edge of the terminal.

## Scope

Update the shared backup and restore human-readable presenter and add regression coverage for consecutive, flush-left output in a terminal and in plain output. The existing progress renderer already starts at the left edge.

Source doc: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md

## Implementation Plan

### Phase 1: Terminal spacing

1.1 Remove presenter padding and verify the layout with regression tests.

## Risks

The presenter is shared across backup CLI commands. Verify color, cursor suspension, fallback modes, and JSON suppression alongside the spacing change.

## Progress

PR: #10771

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Terminal spacing

- [x] 1.1 Remove presenter padding and verify the layout with regression tests. — 94c2330f21
