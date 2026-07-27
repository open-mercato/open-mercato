/**
 * Workflows Module - Activity Registry
 *
 * One declarative entry per activity type: dispatch, validation schema, form
 * spec, async capability, and dry-run behavior live together (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.2).
 *
 * Runtime contract (the sync/async split made explicit):
 * - Lookups are by the activityType STRING on both the sync and async sides;
 *   registry entries are never serialized.
 * - Job payloads carry `activityType` plus the already-interpolated config.
 * - Interpolation happens at enqueue time for async activities and at
 *   dispatch time for sync activities.
 * - This module stays PURE: no React, no MikroORM/EntityManager, and no
 *   Awilix container imports at module scope — type-only imports only — so
 *   both the UI and the worker can load it without dragging in either
 *   runtime.
 */

import type { ZodTypeAny } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ActivityContext } from './activity-executor'

export type ActivityAsyncCapability =
  | { capable: true }
  | { capable: false; reason: string }

export interface ActivityFormFieldSpec {
  id: string
  component: string
  labelKey?: string
  descriptionKey?: string
  required?: boolean
}

export interface ActivityExecuteDeps {
  em: EntityManager
  container: AwilixContainer
  signal?: AbortSignal
}

export interface ActivityTypeEntry<TConfig = unknown> {
  id: string
  icon: string
  i18nKey: string
  configSchema: ZodTypeAny
  form: ActivityFormFieldSpec[]
  execute: (
    config: TConfig,
    ctx: ActivityContext,
    deps: ActivityExecuteDeps
  ) => Promise<unknown>
  executeAsync?: (
    config: TConfig,
    ctx: ActivityContext,
    deps: ActivityExecuteDeps
  ) => Promise<unknown>
  async: ActivityAsyncCapability
  enqueueDelayMs?: (config: TConfig) => number | null
  mock?: ((config: TConfig, ctx: ActivityContext) => unknown) | 'refuse'
  compensable?: boolean
  outputContract?: 'unknown' | ((config: TConfig) => ZodTypeAny | 'unknown')
}

const registry = new Map<string, ActivityTypeEntry>()

export function registerActivityType<TConfig>(entry: ActivityTypeEntry<TConfig>): void {
  if (registry.has(entry.id)) {
    throw new Error(`[internal] Activity type already registered: ${entry.id}`)
  }
  registry.set(entry.id, entry as ActivityTypeEntry)
}

export function getActivityType(id: string): ActivityTypeEntry | null {
  return registry.get(id) ?? null
}

export function listActivityTypes(): ActivityTypeEntry[] {
  return Array.from(registry.values())
}

export function activityTypeIds(): [string, ...string[]] {
  const ids = Array.from(registry.keys())
  if (ids.length === 0) {
    throw new Error('[internal] Activity registry is empty; register activity types before requesting ids')
  }
  return ids as [string, ...string[]]
}
