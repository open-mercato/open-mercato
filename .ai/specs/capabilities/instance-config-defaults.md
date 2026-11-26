# Capability: instance-config-defaults

Allows enabled modules to declare instance-scoped configuration defaults restored strictly and transactionally by Configs before tenant setup.

## Requirement: Restore shipped instance configuration defaults
The command SHALL force-restore configuration defaults declared by enabled owners and preserve rows belonging to disabled owners.

### Scenario: Search is disabled and Notifications is enabled
- WHEN an operator runs the existing restore command with a pre-existing Search row
- THEN Notifications is restored at instance scope, the Search row retains its value and timestamp, and no Search row is inserted if it was absent.

### Scenario: Search is enabled
- WHEN an operator restores defaults with the current or legacy vector auto-indexing environment setting
- THEN the existing precedence determines the value stored under `vector.auto_index_enabled` without changing tenant overrides.

### Scenario: A nonempty owner catalog fails to restore during init
- WHEN the strict restore cannot resolve an EntityManager, or an entry lookup, persistence step, or flush fails
- THEN restore exits nonzero, no catalog changes or refreshed cache entries are published, and init never invokes `auth setup` or tenant hooks.

Source: .ai/specs/2026-11-24-module-owned-instance-config-defaults.md
