/**
 * Workflows Module - Event Trigger Service
 *
 * Core service for evaluating and processing workflow event triggers.
 * Handles pattern matching, filter evaluation, context mapping, and workflow starting.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CacheService } from '@open-mercato/cache'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import {
  WorkflowEventTrigger,
  WorkflowDefinition,
  WorkflowInstance,
  type TriggerFilterCondition,
  type TriggerContextMapping,
  type WorkflowEventTriggerConfig,
  type WorkflowDefinitionTrigger,
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

/**
 * Unified trigger interface for both legacy (entity) and embedded (definition) triggers
 */
export interface UnifiedTrigger {
  id: string  // For legacy: entity ID, for embedded: `${definitionId}:${triggerId}`
  triggerId: string
  name: string
  description?: string | null
  eventPattern: string
  config: WorkflowEventTriggerConfig | null
  enabled: boolean
  priority: number
  workflowDefinitionId: string
  workflowId: string
  workflowVersion: number
  source: 'legacy' | 'embedded'
  tenantId: string
  organizationId: string
}

interface CachedTriggers {
  triggers: UnifiedTrigger[]
  cachedAt: number
}

// Cache TTL: 5 minutes
const TRIGGER_CACHE_TTL = 5 * 60 * 1000

// ============================================================================
// Pattern Matching
// ============================================================================

// ============================================================================
// Filter Evaluation
// ============================================================================

const MAX_WORKFLOW_REGEX_PATTERN_LENGTH = 200
const MAX_WORKFLOW_REGEX_INPUT_LENGTH = 10_000

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

function getQuantifierEnd(pattern: string, index: number): number | null {
  const char = pattern[index]
  if (char === '*' || char === '+' || char === '?') return index
  if (char !== '{') return null

  const closeIndex = pattern.indexOf('}', index + 1)
  if (closeIndex === -1) return null

  const body = pattern.slice(index + 1, closeIndex)
  return /^[0-9]+(?:,[0-9]*)?$/.test(body) ? closeIndex : null
}

interface RegexGroupFrame {
  hasAlternation: boolean
  hasQuantifier: boolean
}

function isSafeWorkflowRegexPattern(pattern: string): boolean {
  if (pattern.length > MAX_WORKFLOW_REGEX_PATTERN_LENGTH) return false

  const groupStack: RegexGroupFrame[] = [{ hasAlternation: false, hasQuantifier: false }]
  let inCharClass = false
  let lastClosedGroup: RegexGroupFrame | null = null
  let lastAtomWasQuantified = false

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (char === '\\') {
      const next = pattern[index + 1]
      if (!inCharClass && (/[1-9]/.test(next ?? '') || (next === 'k' && pattern[index + 2] === '<'))) {
        return false
      }
      index += 1
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (inCharClass) {
      if (char === ']') {
        inCharClass = false
        lastAtomWasQuantified = false
      }
      lastClosedGroup = null
      continue
    }

    if (char === '[') {
      inCharClass = true
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (char === '(') {
      if (pattern[index + 1] === '?') {
        if (pattern[index + 2] !== ':') return false
        index += 2
      }

      groupStack.push({ hasAlternation: false, hasQuantifier: false })
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (char === ')') {
      if (groupStack.length === 1) return false
      lastClosedGroup = groupStack.pop()!
      lastAtomWasQuantified = false
      continue
    }

    if (char === '|') {
      groupStack[groupStack.length - 1].hasAlternation = true
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    const quantifierEnd = getQuantifierEnd(pattern, index)
    if (quantifierEnd !== null) {
      if (lastAtomWasQuantified) return false
      if (lastClosedGroup?.hasAlternation || lastClosedGroup?.hasQuantifier) return false

      groupStack[groupStack.length - 1].hasQuantifier = true
      lastClosedGroup = null
      lastAtomWasQuantified = true
      index = quantifierEnd

      if (pattern[index + 1] === '?') {
        index += 1
      }

      continue
    }

    lastClosedGroup = null
    lastAtomWasQuantified = false
  }

  return groupStack.length === 1 && !inCharClass
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
      if (value.length > MAX_WORKFLOW_REGEX_INPUT_LENGTH) return false
      if (!isSafeWorkflowRegexPattern(expected)) return false
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
 * Load legacy triggers from WorkflowEventTrigger entity table.
 * For backward compatibility with existing triggers.
 */
async function loadLegacyTriggers(
  em: EntityManager,
  tenantId: string,
  organizationId: string
): Promise<UnifiedTrigger[]> {
  const legacyTriggers = await em.find(
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

  // Get definitions for these triggers to get workflowId
  const definitionIds = [...new Set(legacyTriggers.map(t => t.workflowDefinitionId))]
  const definitions = definitionIds.length > 0 ? await em.find(WorkflowDefinition, {
    id: { $in: definitionIds },
    enabled: true,
    deletedAt: null,
  }) : []
  const definitionMap = new Map(definitions.map(d => [d.id, d]))

  return legacyTriggers
    .filter(t => definitionMap.has(t.workflowDefinitionId))
    .map(t => {
      const def = definitionMap.get(t.workflowDefinitionId)!
      return {
        id: t.id,
        triggerId: t.id,
        name: t.name,
        description: t.description,
        eventPattern: t.eventPattern,
        config: t.config ?? null,
        enabled: t.enabled,
        priority: t.priority,
        workflowDefinitionId: t.workflowDefinitionId,
        workflowId: def.workflowId,
        workflowVersion: def.version,
        source: 'legacy' as const,
        tenantId: t.tenantId,
        organizationId: t.organizationId,
      }
    })
}

/**
 * Load embedded triggers from workflow definitions.
 * New triggers are embedded directly in the definition JSONB.
 */
async function loadEmbeddedTriggers(
  em: EntityManager,
  tenantId: string,
  organizationId: string
): Promise<UnifiedTrigger[]> {
  // Load all enabled definitions that may have triggers
  const definitions = await em.find(
    WorkflowDefinition,
    {
      tenantId,
      organizationId,
      enabled: true,
      deletedAt: null,
    }
  )

  const triggers: UnifiedTrigger[] = []

  for (const def of definitions) {
    const embeddedTriggers = def.definition?.triggers as WorkflowDefinitionTrigger[] | undefined
    if (!embeddedTriggers || embeddedTriggers.length === 0) continue

    for (const trigger of embeddedTriggers) {
      if (!trigger.enabled) continue

      triggers.push({
        id: `${def.id}:${trigger.triggerId}`,
        triggerId: trigger.triggerId,
        name: trigger.name,
        description: trigger.description ?? null,
        eventPattern: trigger.eventPattern,
        config: trigger.config ?? null,
        enabled: trigger.enabled,
        priority: trigger.priority,
        workflowDefinitionId: def.id,
        workflowId: def.workflowId,
        workflowVersion: def.version,
        source: 'embedded' as const,
        tenantId,
        organizationId,
      })
    }
  }

  return triggers
}

/**
 * Load all enabled triggers for a tenant/organization with caching.
 * Merges both legacy (entity) triggers and embedded (definition) triggers.
 */
export async function loadTriggersForTenant(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  cacheService?: CacheService
): Promise<UnifiedTrigger[]> {
  const cacheKey = getCacheKey(tenantId, organizationId)

  // Check in-memory cache
  const cached = triggerCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < TRIGGER_CACHE_TTL) {
    return cached.triggers
  }

  // Load from both sources
  const [legacyTriggers, embeddedTriggers] = await Promise.all([
    loadLegacyTriggers(em, tenantId, organizationId),
    loadEmbeddedTriggers(em, tenantId, organizationId),
  ])

  // Merge and sort by priority (higher first)
  const allTriggers = [...legacyTriggers, ...embeddedTriggers]
    .sort((a, b) => b.priority - a.priority)

  // Update cache
  triggerCache.set(cacheKey, {
    triggers: allTriggers,
    cachedAt: Date.now(),
  })

  return allTriggers
}

/**
 * Invalidate trigger cache for a tenant/organization.
 * Call this when:
 * - Legacy triggers are created/updated/deleted
 * - Workflow definitions with embedded triggers are created/updated/deleted
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
): Promise<UnifiedTrigger[]> {
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
    if (!evaluateFilterConditions(trigger.config?.filterConditions, context.payload)) {
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
  trigger: UnifiedTrigger
): Promise<boolean> {
  const maxInstances = trigger.config?.maxConcurrentInstances

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

  // Process each trigger (definitions already validated during loading)
  for (const trigger of triggers) {
    try {
      // Check concurrency limit
      const canStart = await checkConcurrencyLimit(em, trigger)
      if (!canStart) {
        console.log(`[workflow-trigger] Skipping trigger "${trigger.name}": max concurrent instances reached`)
        result.skipped++
        continue
      }

      // Map event payload to workflow context
      const mappedContext = mapEventToContext(trigger.config?.contextMapping, context.payload)

      // Extract entity info from payload for metadata
      const payloadId = context.payload?.id as string | undefined
      const payloadEntityType = context.payload?.entityType as string | undefined

      // Include event metadata and payload in context
      const initialContext = {
        // Include raw event payload fields (e.g., id, organizationId, tenantId)
        ...context.payload,
        // Override with explicit mappings if provided
        ...mappedContext,
        __trigger: {
          triggerId: trigger.id,
          triggerName: trigger.name,
          eventName: context.eventName,
          eventPayload: context.payload,
          triggeredAt: new Date().toISOString(),
          source: trigger.source,
        },
      }

      // Start workflow
      const instance = await startWorkflow(em, {
        workflowId: trigger.workflowId,
        version: trigger.workflowVersion,
        initialContext,
        metadata: {
          initiatedBy: `trigger:${trigger.id}`,
          // Include entityId and entityType for widget discovery
          entityId: payloadId,
          entityType: payloadEntityType || trigger.config?.entityType,
          labels: {
            trigger_id: trigger.id,
            trigger_name: trigger.name,
            event_name: context.eventName,
            trigger_source: trigger.source,
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
