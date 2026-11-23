# Capability: upgrade-actions

Lets module authors ship one-time, per-organization data upgrades from their own module, and lets administrators and release operators inspect, apply and safely revert them through the banner and the CLI.

## Requirement: Discover module-owned upgrade files
The system SHALL expose eligible actions declared by enabled modules through the same catalog used by the upgrade API and CLI.

### Scenario: An optional module is turned off
- WHEN a generated deployment excludes the module that owns an action or an explicitly required peer is unavailable
- THEN the action is unavailable in both entry points, its handler is never invoked, and any historical completion row remains intact

Source: .ai/specs/2026-11-23-module-owned-upgrade-actions.md

## Requirement: Inspect and apply upgrade actions through the CLI
The CLI SHALL list and apply eligible actions for one validated tenant and organization through the same completion ledger as HTTP.

### Scenario: An action was completed through the banner
- WHEN an operator runs `list` and then `up` in that scope
- THEN the CLI shows the action as applied, skips its handler and reports the count of newly applied actions

Source: .ai/specs/2026-11-23-module-owned-upgrade-actions.md

## Requirement: Revert one reversible upgrade action
The CLI SHALL revert a targeted, completed action only through its declared compensation.

### Scenario: The inverse is unavailable or fails
- WHEN an operator targets a forward-only action or its inverse rejects the current state
- THEN the command fails, retains the completion row, and leaves the action applied

Source: .ai/specs/2026-11-23-module-owned-upgrade-actions.md
