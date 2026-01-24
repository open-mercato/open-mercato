/**
 * Workflows Module - Event Trigger Service
 *
 * Core service for evaluating and processing workflow event triggers.
 * Handles pattern matching, filter evaluation, context mapping, and workflow starting.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CacheService } from '@open-mercato/cache'
import {
  WorkflowEventTrigger,
  WorkflowDefinition,
  WorkflowInstance,
  type TriggerFilterCondition,
  type TriggerContextMapping,
  type WorkflowEventTriggerConfig,
} from '../data/entities'
import { startWorkflow, executeWorkflow } from './workflow-executor'

// ============================================================================
// Types
// ============================================================================

export interface EventTriggerContext {
  eventName: string
  payload: Record<string, unknown>
  tenantId: string
  organizationId: string
}

export interface ProcessTriggersResult {
  triggered: number
  skipped: number
  errors: Array<{ triggerId: string; error: string }>
  instances: Array<{ triggerId: string; instanceId: string }>
}

interface CachedTriggers {
  triggers: WorkflowEventTrigger[]
  cachedAt: number
}

// Cache TTL: 5 minutes
const TRIGGER_CACHE_TTL = 5 * 60 * 1000

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Match an event name against a pattern.
 *
 * Supports:
 * - Exact match: `customers.people.created`
 * - Wildcard `*` matches single segment: `customers.*` matches `customers.people` but not `customers.people.created`
 * - Global wildcard: `*` alone matches all events
 */
export function matchEventPattern(eventName: string, pattern: string): boolean {
  // Global wildcard matches all events
  if (pattern === '*') return true

  // Exact match
  if (pattern === eventName) return true

  // No wildcards in pattern means we need exact match, which already failed
  if (!pattern.includes('*')) return false

  // Convert pattern to regex:
  // - Escape regex special chars (except *)
  // - Replace * with [^.]+ (match one or more non-dot chars)
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+')
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(eventName)
}

// ============================================================================
// Filter Evaluation
// ============================================================================

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Evaluate a single filter condition against the event payload.
 */
function evaluateCondition(condition: TriggerFilterCondition, payload: Record<string, unknown>): boolean {
  const value = getNestedValue(payload, condition.field)
  const expected = condition.value

  switch (condition.operator) {
    case 'eq':
      return value === expected

    case 'neq':
      return value !== expected

    case 'gt':
      return typeof value === 'number' && typeof expected === 'number' && value > expected

    case 'gte':
      return typeof value === 'number' && typeof expected === 'number' && value >= expected

    case 'lt':
      return typeof value === 'number' && typeof expected === 'number' && value < expected

    case 'lte':
      return typeof value === 'number' && typeof expected === 'number' && value <= expected

    case 'contains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return value.includes(expected)
      }
      if (Array.isArray(value)) {
        return value.includes(expected)
      }
      return false

    case 'startsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected)

    case 'endsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected)

    case 'in':
      return Array.isArray(expected) && expected.includes(value)

    case 'notIn':
      return Array.isArray(expected) && !expected.includes(value)

    case 'exists':
      return value !== undefined && value !== null

    case 'notExists':
      return value === undefined || value === null

    case 'regex':
      if (typeof value !== 'string' || typeof expected !== 'string') return false
      try {
        const regex = new RegExp(expected)
        return regex.test(value)
      } catch {
        return false
      }

    default:
      return false
  }
}

/**
 * Evaluate all filter conditions against the event payload.
 * All conditions must pass (AND logic).
 */
export function evaluateFilterConditions(
  conditions: TriggerFilterCondition[] | undefined,
  payload: Record<string, unknown>
): boolean {
  if (!conditions || conditions.length === 0) return true

  return conditions.every(condition => evaluateCondition(condition, payload))
}

// ============================================================================
// Context Mapping
// ============================================================================

/**
 * Map event payload to workflow initial context.
 */
export function mapEventToContext(
  mapping: TriggerContextMapping[] | undefined,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const context: Record<string, unknown> = {}

  if (!mapping || mapping.length === 0) return context

  for (const item of mapping) {
    const value = getNestedValue(payload, item.sourceExpression)
    context[item.targetKey] = value !== undefined ? value : item.defaultValue
  }

  return context
}

// ============================================================================
// Trigger Loading with Caching
// ============================================================================

// In-memory cache for triggers (per tenant/org)
const triggerCache = new Map<string, CachedTriggers>()

function getCacheKey(tenantId: string, organizationId: string): string {
  return `${tenantId}:${organizationId}`
}

/**
 * Load enabled triggers for a tenant/organization with caching.
 */
export async function loadTriggersForTenant(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  cacheService?: CacheService
): Promise<WorkflowEventTrigger[]> {
  const cacheKey = getCacheKey(tenantId, organizationId)

  // Check in-memory cache
  const cached = triggerCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < TRIGGER_CACHE_TTL) {
    return cached.triggers
  }

  // Load from database
  const triggers = await em.find(
    WorkflowEventTrigger,
    {
      tenantId,
      organizationId,
      enabled: true,
      deletedAt: null,
    },
    {
      orderBy: { priority: 'DESC', createdAt: 'ASC' },
    }
  )

  // Update cache
  triggerCache.set(cacheKey, {
    triggers,
    cachedAt: Date.now(),
  })

  return triggers
}

/**
 * Invalidate trigger cache for a tenant/organization.
 * Call this when triggers are created/updated/deleted.
 */
export function invalidateTriggerCache(tenantId: string, organizationId?: string): void {
  if (organizationId) {
    // Invalidate specific org
    const cacheKey = getCacheKey(tenantId, organizationId)
    triggerCache.delete(cacheKey)
  } else {
    // Invalidate all orgs for tenant
    for (const key of triggerCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        triggerCache.delete(key)
      }
    }
  }
}

// ============================================================================
// Trigger Matching
// ============================================================================

/**
 * Find all triggers that match an event.
 */
export async function findMatchingTriggers(
  em: EntityManager,
  context: EventTriggerContext
): Promise<WorkflowEventTrigger[]> {
  const triggers = await loadTriggersForTenant(
    em,
    context.tenantId,
    context.organizationId
  )

  return triggers.filter(trigger => {
    // Check event pattern
    if (!matchEventPattern(context.eventName, trigger.eventPattern)) {
      return false
    }

    // Check filter conditions
    const config = trigger.config as WorkflowEventTriggerConfig | null
    if (!evaluateFilterConditions(config?.filterConditions, context.payload)) {
      return false
    }

    return true
  })
}

// ============================================================================
// Trigger Processing
// ============================================================================

/**
 * Check if max concurrent instances limit is reached.
 */
async function checkConcurrencyLimit(
  em: EntityManager,
  trigger: WorkflowEventTrigger
): Promise<boolean> {
  const config = trigger.config as WorkflowEventTriggerConfig | null
  const maxInstances = config?.maxConcurrentInstances

  if (!maxInstances) return true // No limit

  // Count running instances for this trigger's workflow definition
  const runningCount = await em.count(WorkflowInstance, {
    definitionId: trigger.workflowDefinitionId,
    status: { $in: ['RUNNING', 'WAITING_FOR_ACTIVITIES'] },
    tenantId: trigger.tenantId,
    organizationId: trigger.organizationId,
    deletedAt: null,
  })

  return runningCount < maxInstances
}

/**
 * Process all matching triggers for an event and start workflows.
 */
export async function processEventTriggers(
  em: EntityManager,
  container: AwilixContainer,
  context: EventTriggerContext
): Promise<ProcessTriggersResult> {
  const result: ProcessTriggersResult = {
    triggered: 0,
    skipped: 0,
    errors: [],
    instances: [],
  }

  // Find matching triggers
  const triggers = await findMatchingTriggers(em, context)

  if (triggers.length === 0) {
    return result
  }

  // Validate workflow definitions exist
  const definitionIds = [...new Set(triggers.map(t => t.workflowDefinitionId))]
  const definitions = await em.find(WorkflowDefinition, {
    id: { $in: definitionIds },
    enabled: true,
    deletedAt: null,
  })

  const validDefinitionIds = new Set(definitions.map(d => d.id))

  // Process each trigger
  for (const trigger of triggers) {
    try {
      // Check if definition is valid
      if (!validDefinitionIds.has(trigger.workflowDefinitionId)) {
        console.warn(`[workflow-trigger] Skipping trigger "${trigger.name}": workflow definition not found or disabled`)
        result.skipped++
        continue
      }

      // Check concurrency limit
      const canStart = await checkConcurrencyLimit(em, trigger)
      if (!canStart) {
        console.log(`[workflow-trigger] Skipping trigger "${trigger.name}": max concurrent instances reached`)
        result.skipped++
        continue
      }

      // Get definition
      const definition = definitions.find(d => d.id === trigger.workflowDefinitionId)!

      // Map event payload to workflow context
      const config = trigger.config as WorkflowEventTriggerConfig | null
      const mappedContext = mapEventToContext(config?.contextMapping, context.payload)

      // Include event metadata in context
      const initialContext = {
        ...mappedContext,
        __trigger: {
          triggerId: trigger.id,
          triggerName: trigger.name,
          eventName: context.eventName,
          eventPayload: context.payload,
          triggeredAt: new Date().toISOString(),
        },
      }

      // Start workflow
      const instance = await startWorkflow(em, {
        workflowId: definition.workflowId,
        version: definition.version,
        initialContext,
        metadata: {
          initiatedBy: `trigger:${trigger.id}`,
          labels: {
            trigger_id: trigger.id,
            trigger_name: trigger.name,
            event_name: context.eventName,
          },
        },
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      })

      result.triggered++
      result.instances.push({
        triggerId: trigger.id,
        instanceId: instance.id,
      })

      // Execute workflow asynchronously (don't wait)
      executeWorkflow(em.fork(), container, instance.id).catch(err => {
        console.error(`[workflow-trigger] Error executing workflow ${instance.id}:`, err)
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[workflow-trigger] Error processing trigger "${trigger.name}":`, error)
      result.errors.push({
        triggerId: trigger.id,
        error: errorMessage,
      })
    }
  }

  return result
}
