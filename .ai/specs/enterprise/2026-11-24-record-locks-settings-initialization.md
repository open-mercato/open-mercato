# Configs-owned initialization of Record Locks settings

Extends: .ai/specs/implemented/SPEC-013-2026-01-27-decouple-module-setup.md
Extends: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md

## TLDR

Record Locks declares its settings defaults and merge policy. Configs applies them to the existing instance row during tenant setup.

## Resolved assumptions (autonomous defaults)

Keep the global settings key and current tenant-hook timing. The settings initializer can ship independently of Audit Logs reads and the pre-tenant instance-default catalog.

## Overview

This is the settings part of workstream 3 of [#10476](https://github.com/open-mercato/open-mercato/issues/10476). Start after [#10129](https://github.com/open-mercato/open-mercato/pull/10129). Configs supplies a generic owner operation and carries no Record Locks dependency.

## Problem Statement

The post-#10129 setup hook skips when Configs metadata is missing. It still queries and writes the private ModuleConfig entity when present. The tenant hook currently receives an EntityManager and tenant/organization IDs. [Settings hook](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/enterprise/src/modules/record_locks/setup.ts#L5-L37)

## Proposed Solution

Apply the merge through a Configs-owned service using the setup manager. The shared storage ownership follows the [WordPress Options API pattern](https://developer.wordpress.org/plugins/settings/options-api/), with an atomic merge for the existing Record Locks defaults.

## Architecture

- Keep `record_locks/setup.ts` as the seed owner. The optional Configs capability accepts the setup EntityManager and an instance-only key plus an initialize/merge function. Lock the existing global key or use the existing unique index with conflict-safe retry. The operation preserves an existing nonempty `enabledResources` list and other properties, fills only the missing/empty list, and inserts the shipped defaults when no global row exists. The consumer decides the values and Configs owns persistence and cache refresh.
- `setupInitialTenant` calls hooks with only the manager and scope today. Add an optional setup container field and thread the active container from Auth CLI and Onboarding. Preserve the signature for existing callers. The shared server setup boundary supplies a bootstrapped container for legacy calls with Configs enabled and disposes it if it created one. Use the supplied setup manager for the write so it shares the existing setup lifecycle. Respect the effective setup module set, including explicit caller overrides. Cache publication happens after the write commits, with warmed-cache and transaction-failure coverage.
- When Configs is absent, skip the initializer and retain the existing default settings path. When present, persistence failures are setup failures under the existing workflow. The Enterprise guard registration and core version fallback must remain resolvable independently of Audit Logs and Configs.

## Data Model

Use the existing `module_configs` key `record_locks.settings` with null tenant and organization. The global unique index remains authoritative. No schema changes or backfill are needed.

## API Contracts

Keep settings GET and POST, current permission checks and conflict/guard behavior. Expose the additive initializer only through internal server DI. Do not change the settings UI or runtime default when Configs is absent.

## Migration & Backward Compatibility

Preserve the optional hook signature extension, terminology, settings key, existing public DI keys and response shapes. Older binaries can use every row written by this design. Restore previous settings through the existing settings surface when needed.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — missing Configs breaks tenant setup or version enforcement. | Exercise setup and actual updates with Configs absent. Keep absence distinct from an operational error in a present Configs provider. |
| Medium — setup overwrites customizations or leaves stale cache data. | Only initialize or fill the missing default field, serialize concurrent initializers, and refresh the cache after commit. Test explicit tenant rows stay untouched. |

## Phasing

Ship one implementation PR for the initializer and the existing tenant setup entry points.

## Implementation Plan

1. Characterize first setup, existing settings, a missing or empty resource list, repeated setup, and absence of Configs. Reuse the Record Locks optional-peer integration fixture.
2. Add the Configs initializer and thread the setup container through Auth CLI and Onboarding. Verify existing direct `setupInitialTenant` callers continue to seed defaults on the same setup manager, and supplied module overrides still win.
3. Switch Record Locks. Exercise CLI and onboarding setup, existing settings API GET/POST, wrong scope, idempotent and concurrent setup, rollback and warmed-cache reads. Verify the global version guard still rejects stale writes with Configs absent.

## Final Compliance Report

Reviewed Configs storage ownership, instance scope, initialization timing, cache publication and the optional peer fallback. Runtime verification belongs to the implementation PR.

## Changelog

- 2026-11-24 — Proposed Configs-owned initialization for #10476.
