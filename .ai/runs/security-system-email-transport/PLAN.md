# Security System Email Transport – Defensive Fix

## Objective
Implement defensive fix for open-mercato/open-mercato #10594.
Preserve trust boundary for security-sensitive system email delivery and keep scope of tenant-configured channels explicit.
Reuse existing transport and policy abstractions. Verify with fake transports.

## Context
System email delivery is security-sensitive (password reset, invites, etc.). Tenant-configured channels must remain explicit and must not be implicitly used for system emails. Existing `sendSystemEmail` resolves tenant channels and may fall back to instance-wide env credentials. Defensive posture: ensure system email transport is isolated from tenant channel scope and never implicitly borrows tenant credentials.

## Plan
1. Check for equivalent active/merged fix – none found.
2. Create isolated worktree from origin/main – done.
3. Add defensive guard in `sendSystemEmail`:
   - System email transport must remain instance-wide. If a tenant channel is resolved (`hasTenantChannel === true`), fail closed rather than silently using tenant credentials. This preserves trust boundary and makes tenant channel scope explicit.
   - Keep existing upgrade path for tenants without a channel (fallback to env).
4. Reuse existing transport abstractions (`channelAdapterRegistry`, `system-email-provider-config`, `isSystemEmailTransportConfigured`).
5. Add verification with fake transports in unit tests:
   - Fake transport adapter records scope and credentials used.
   - Test that system email with tenant channel present fails closed with explicit error.
   - Test that system email without tenant channel uses instance-wide env credentials and scope is system-wide.
6. Validation:
   - `yarn generate`
   - `yarn typecheck`
   - `yarn test` for `communication_channels` system-email tests.

## Compatibility
No public contract change. Defensive fail-closed only. Existing upgrade path unchanged for tenants without channel.

## Acceptance
PR open for human acceptance, no merge, no migrations.
