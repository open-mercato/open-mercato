/**
 * Edge Form Transforms
 *
 * Utilities to convert between React Flow edge data structures and CrudForm field values.
 * Handles bidirectional transformation for transitions/edges with proper type safety.
 */

import type { Edge } from '@xyflow/react'
import type { Activity } from '../components/fields/ActivityArrayEditor'
import type { TransitionCondition } from '../components/fields/BusinessRuleConditionsEditor'

/**
 * Normalized condition format (object only, no string)
 */
export interface NormalizedCondition {
  ruleId: string
  required: boolean
}

/**
 * Form values interface matching CrudForm field structure
 */
export interface EdgeFormValues {
  transitionName: string
  trigger: string
  priority: string // Number as string in form
  continueOnActivityFailure: boolean
  preConditions: NormalizedCondition[]
  postConditions: NormalizedCondition[]
  activities: Activity[]
  advancedConfig?: string
}

/**
 * Generate a readable name from edge ID
 * Example: "start_to_cart" -> "Start → Cart"
 */
function generateNameFromId(edgeId: string): string {
  return edgeId
    .split('_to_')
    .map(part => part.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' '))
    .join(' → ')
}

/**
 * Normalize legacy string format to object format
 */
export function normalizeCondition(raw: string | TransitionCondition): NormalizedCondition {
  if (typeof raw === 'string') {
    return { ruleId: raw, required: true }
  }
  return raw as NormalizedCondition
}

/**
 * Normalize array of conditions (handles both string and object formats)
 */
export function normalizeConditions(raw: any[]): NormalizedCondition[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeCondition)
}

/**
 * Convert Edge data to CrudForm values
 */
export function edgeToFormValues(edge: Edge): EdgeFormValues {
  const edgeData = edge.data as any

  // Try to get transition name from various sources
  let transitionName = ''
  if (edgeData?.transitionName && edgeData.transitionName !== '') {
    transitionName = edgeData.transitionName
  } else if (edgeData?.label && edgeData.label !== '' && edgeData.label !== undefined) {
    transitionName = edgeData.label
  } else {
    // Generate a name from the edge ID as fallback
    transitionName = generateNameFromId(edge.id)
  }

  return {
    transitionName,
    trigger: edgeData?.trigger || 'auto',
    priority: (edgeData?.priority || 100).toString(),
    continueOnActivityFailure: edgeData?.continueOnActivityFailure !== undefined
      ? edgeData.continueOnActivityFailure
      : true,
    preConditions: normalizeConditions(edgeData?.preConditions || []),
    postConditions: normalizeConditions(edgeData?.postConditions || []),
    activities: edgeData?.activities || [],
    advancedConfig: '', // Advanced config is empty initially (can be populated from edgeData if needed)
  }
}

/**
 * Convert CrudForm values back to Edge data updates
 *
 * Returns partial edge data to be merged with existing edge data.
 */
export function formValuesToEdgeUpdates(
  values: EdgeFormValues,
  edge: Edge
): Partial<Edge['data']> {
  const updates: Partial<Edge['data']> = {
    transitionName: values.transitionName,
    label: values.transitionName, // Keep label for backward compatibility
    trigger: values.trigger,
    priority: parseInt(values.priority) || 100,
    continueOnActivityFailure: values.continueOnActivityFailure,
    preConditions: values.preConditions.length > 0 ? values.preConditions : undefined,
    postConditions: values.postConditions.length > 0 ? values.postConditions : undefined,
    activities: values.activities.length > 0 ? values.activities : undefined,
  }

  // Parse advanced config (JSON) and merge
  if (values.advancedConfig && values.advancedConfig.trim()) {
    try {
      const parsed = JSON.parse(values.advancedConfig)
      Object.assign(updates, parsed)
    } catch (error) {
      console.error('Invalid JSON in Advanced Configuration:', error)
      throw new Error('Invalid JSON in Advanced Configuration. Please check your syntax.')
    }
  }

  return updates
}

/**
 * Get excluded rule IDs for business rule selector
 * (to avoid selecting the same rule twice)
 */
export function getExcludedPreConditionRuleIds(values: EdgeFormValues): string[] {
  return values.preConditions.map(c => {
    const normalized = normalizeCondition(c)
    return normalized.ruleId
  })
}

/**
 * Get excluded rule IDs for business rule selector
 * (to avoid selecting the same rule twice)
 */
export function getExcludedPostConditionRuleIds(values: EdgeFormValues): string[] {
  return values.postConditions.map(c => {
    const normalized = normalizeCondition(c)
    return normalized.ruleId
  })
}
