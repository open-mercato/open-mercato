/**
 * Workflows Module - Transition Handler Service
 *
 * Handles workflow transitions between steps:
 * - Evaluating if a transition is valid (checking conditions)
 * - Executing transitions (moving from one step to another)
 * - Integrating with business rules engine for pre/post conditions
 * - Executing activities on transition
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  WorkflowInstance,
  WorkflowDefinition,
  WorkflowEvent,
} from '../data/entities'
import * as ruleEvaluator from '../../business_rules/lib/rule-evaluator'
import * as ruleEngine from '../../business_rules/lib/rule-engine'
import type { RuleEngineContext } from '../../business_rules/lib/rule-engine'
import * as activityExecutor from './activity-executor'
import type { ActivityDefinition } from './activity-executor'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface TransitionEvaluationContext {
  workflowContext: Record<string, any>
  userId?: string
  triggerData?: any
}

export interface TransitionEvaluationResult {
  isValid: boolean
  transition?: any
  reason?: string
  failedConditions?: string[]
  evaluationTime?: number
}

export interface TransitionExecutionContext {
  workflowContext: Record<string, any>
  userId?: string
  triggerData?: any
}

export interface TransitionExecutionResult {
  success: boolean
  nextStepId?: string
  conditionsEvaluated?: {
    preConditions: boolean
    postConditions: boolean
  }
  error?: string
}

export class TransitionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'TransitionError'
  }
}

// ============================================================================
// Main Transition Functions
// ============================================================================

/**
 * Evaluate if a transition from current step to target step is valid
 *
 * Checks:
 * - Transition exists in workflow definition
 * - Pre-conditions pass (if any business rules defined)
 * - Transition condition evaluates to true (if specified)
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param fromStepId - Current step ID
 * @param toStepId - Target step ID (optional - will auto-select if not provided)
 * @param context - Evaluation context
 * @returns Evaluation result with validity and reason
 */
export async function evaluateTransition(
  em: EntityManager,
  instance: WorkflowInstance,
  fromStepId: string,
  toStepId: string | undefined,
  context: TransitionEvaluationContext
): Promise<TransitionEvaluationResult> {
  const startTime = Date.now()

  try {
    // Load workflow definition
    const definition = await em.findOne(WorkflowDefinition, {
      id: instance.definitionId,
    })

    if (!definition) {
      return {
        isValid: false,
        reason: `Workflow definition not found: ${instance.definitionId}`,
        evaluationTime: Date.now() - startTime,
      }
    }

    // Find transition
    const transitions = definition.definition.transitions || []
    let transition: any

    if (toStepId) {
      // Find specific transition
      transition = transitions.find(
        (t: any) => t.fromStepId === fromStepId && t.toStepId === toStepId
      )

      if (!transition) {
        return {
          isValid: false,
          reason: `No transition found from ${fromStepId} to ${toStepId}`,
          evaluationTime: Date.now() - startTime,
        }
      }
    } else {
      // Auto-select first valid transition
      const availableTransitions = transitions.filter(
        (t: any) => t.fromStepId === fromStepId
      )

      if (availableTransitions.length === 0) {
        return {
          isValid: false,
          reason: `No transitions available from step ${fromStepId}`,
          evaluationTime: Date.now() - startTime,
        }
      }

      // Evaluate each transition to find first valid one
      for (const t of availableTransitions) {
        const result = await evaluateTransitionConditions(
          em,
          instance,
          t,
          context
        )

        if (result.isValid) {
          transition = t
          break
        }
      }

      if (!transition) {
        return {
          isValid: false,
          reason: `No valid transitions found from step ${fromStepId}`,
          evaluationTime: Date.now() - startTime,
        }
      }
    }

    // Evaluate transition conditions (inline condition + business rules pre-conditions)
    const conditionResult = await evaluateTransitionConditions(
      em,
      instance,
      transition,
      context
    )

    return {
      ...conditionResult,
      transition,
      evaluationTime: Date.now() - startTime,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      isValid: false,
      reason: `Transition evaluation error: ${errorMessage}`,
      evaluationTime: Date.now() - startTime,
    }
  }
}

/**
 * Find all valid transitions from current step
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param fromStepId - Current step ID
 * @param context - Evaluation context
 * @returns Array of evaluation results for all transitions
 */
export async function findValidTransitions(
  em: EntityManager,
  instance: WorkflowInstance,
  fromStepId: string,
  context: TransitionEvaluationContext
): Promise<TransitionEvaluationResult[]> {
  try {
    // Load workflow definition
    const definition = await em.findOne(WorkflowDefinition, {
      id: instance.definitionId,
    })

    if (!definition) {
      return []
    }

    // Find all transitions from current step
    const transitions = (definition.definition.transitions || []).filter(
      (t: any) => t.fromStepId === fromStepId
    )

    // Evaluate each transition
    const results: TransitionEvaluationResult[] = []

    for (const transition of transitions) {
      const result = await evaluateTransition(
        em,
        instance,
        fromStepId,
        transition.toStepId,
        context
      )

      results.push(result)
    }

    return results
  } catch (error) {
    console.error('Error finding valid transitions:', error)
    return []
  }
}

/**
 * Execute a transition from one step to another
 *
 * This is the main entry point for transition execution. It:
 * 1. Validates the transition
 * 2. Evaluates pre-conditions
 * 3. Executes activities (if any)
 * 4. Updates workflow instance state (atomically with activity outputs)
 * 5. Evaluates post-conditions
 * 6. Logs transition event
 *
 * @param em - Entity manager
 * @param container - DI container (for activity execution)
 * @param instance - Workflow instance
 * @param fromStepId - Current step ID
 * @param toStepId - Target step ID
 * @param context - Execution context
 * @returns Execution result
 */
export async function executeTransition(
  em: EntityManager,
  container: AwilixContainer,
  instance: WorkflowInstance,
  fromStepId: string,
  toStepId: string,
  context: TransitionExecutionContext
): Promise<TransitionExecutionResult> {
  try {
    // First, evaluate if transition is valid
    const evaluation = await evaluateTransition(
      em,
      instance,
      fromStepId,
      toStepId,
      context
    )

    if (!evaluation.isValid) {
      return {
        success: false,
        error: evaluation.reason || 'Transition validation failed',
      }
    }

    const transition = evaluation.transition!

    // Evaluate pre-conditions (business rules)
    console.log('[TRANSITION] Evaluating pre-conditions for transition:', {
      transitionId: transition.transitionId,
      fromStepId,
      toStepId,
    })

    const preConditionsResult = await evaluatePreConditions(
      em,
      instance,
      transition,
      context
    )

    console.log('[TRANSITION] Pre-conditions result:', {
      allowed: preConditionsResult.allowed,
      executedRulesCount: preConditionsResult.executedRules.length,
      errors: preConditionsResult.errors,
    })

    if (!preConditionsResult.allowed) {
      // Build detailed failure information
      const failedRules = preConditionsResult.executedRules
        .filter((r) => !r.conditionResult)
        .map((r) => ({
          ruleId: r.rule.ruleId,
          ruleName: r.rule.ruleName,
          error: r.error,
        }))

      const failedRulesDetails = failedRules.length > 0
        ? failedRules.map(r => `${r.ruleId}: ${r.error || 'condition failed'}`).join('; ')
        : preConditionsResult.errors?.join(', ') || 'Unknown pre-condition failure'

      console.log('[TRANSITION] ✗ Pre-conditions FAILED:', {
        failedRules,
        errors: preConditionsResult.errors,
      })

      await logTransitionEvent(em, {
        workflowInstanceId: instance.id,
        eventType: 'TRANSITION_REJECTED',
        eventData: {
          fromStepId,
          toStepId,
          transitionId: transition.transitionId || `${fromStepId}->${toStepId}`,
          reason: 'Pre-conditions failed',
          failedRules: failedRulesDetails,
          failedRulesDetail: failedRules,
        },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      return {
        success: false,
        error: `Pre-conditions failed: ${failedRulesDetails}`,
        conditionsEvaluated: {
          preConditions: false,
          postConditions: false,
        },
      }
    }

    // Execute activities (if any)
    let activityOutputs: Record<string, any> = {}
    const activityResults: activityExecutor.ActivityExecutionResult[] = []

    if (transition.activities && transition.activities.length > 0) {
      const activityContext: activityExecutor.ActivityContext = {
        workflowInstance: instance,
        workflowContext: {
          ...instance.context,
          ...context.workflowContext,
        },
        userId: context.userId,
      }

      // Execute all activities
      const results = await activityExecutor.executeActivities(
        em,
        container,
        transition.activities as ActivityDefinition[],
        activityContext
      )

      activityResults.push(...results)

      // Check for failures
      const failedActivities = results.filter(r => !r.success)

      if (failedActivities.length > 0) {
        const continueOnFailure = transition.continueOnActivityFailure ?? true

        // Log activity failures
        await logTransitionEvent(em, {
          workflowInstanceId: instance.id,
          eventType: 'ACTIVITY_FAILED',
          eventData: {
            fromStepId,
            toStepId,
            transitionId: transition.transitionId || `${fromStepId}->${toStepId}`,
            failedActivities: failedActivities.map(f => ({
              activityType: f.activityType,
              activityName: f.activityName,
              error: f.error,
              retryCount: f.retryCount,
            })),
            continueOnFailure,
          },
          userId: context.userId,
          tenantId: instance.tenantId,
          organizationId: instance.organizationId,
        })

        if (!continueOnFailure) {
          return {
            success: false,
            error: `Activities failed: ${failedActivities.map(f => f.error).join(', ')}`,
            conditionsEvaluated: {
              preConditions: true,
              postConditions: false,
            },
          }
        }
      }

      // Collect activity outputs for context update
      results.forEach(result => {
        if (result.success && result.output) {
          const key = result.activityName || result.activityType
          activityOutputs[key] = result.output
        }
      })
    }

    // Update workflow instance - set current step and update context atomically
    instance.currentStepId = toStepId
    instance.context = {
      ...instance.context,
      ...context.workflowContext,
      ...activityOutputs, // Include activity outputs
    }
    instance.updatedAt = new Date()

    await em.flush()

    // Evaluate post-conditions (business rules)
    const postConditionsResult = await evaluatePostConditions(
      em,
      instance,
      transition,
      context
    )

    if (!postConditionsResult.allowed) {
      const failedRules = postConditionsResult.errors?.join(', ') || 'Unknown post-condition failure'

      await logTransitionEvent(em, {
        workflowInstanceId: instance.id,
        eventType: 'TRANSITION_POST_CONDITION_FAILED',
        eventData: {
          fromStepId,
          toStepId,
          transitionId: transition.transitionId || `${fromStepId}->${toStepId}`,
          reason: 'Post-conditions failed',
          failedRules,
        },
        userId: context.userId,
        tenantId: instance.tenantId,
        organizationId: instance.organizationId,
      })

      // Note: We don't roll back the transition on post-condition failure
      // Post-conditions are warnings, not blockers
    }

    // Log successful transition
    await logTransitionEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'TRANSITION_EXECUTED',
      eventData: {
        fromStepId,
        toStepId,
        transitionId: transition.transitionId || `${fromStepId}->${toStepId}`,
        transitionName: transition.transitionName,
        preConditionsPassed: true,
        postConditionsPassed: postConditionsResult.allowed,
        activitiesExecuted: activityResults.length,
        activitiesSucceeded: activityResults.filter(r => r.success).length,
        activitiesFailed: activityResults.filter(r => !r.success).length,
      },
      userId: context.userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    return {
      success: true,
      nextStepId: toStepId,
      conditionsEvaluated: {
        preConditions: true,
        postConditions: postConditionsResult.allowed,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await logTransitionEvent(em, {
      workflowInstanceId: instance.id,
      eventType: 'TRANSITION_FAILED',
      eventData: {
        fromStepId,
        toStepId,
        error: errorMessage,
      },
      userId: context.userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    return {
      success: false,
      error: `Transition execution failed: ${errorMessage}`,
    }
  }
}

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Evaluate transition conditions (inline condition expression)
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param transition - Transition definition
 * @param context - Evaluation context
 * @returns Evaluation result
 */
async function evaluateTransitionConditions(
  em: EntityManager,
  instance: WorkflowInstance,
  transition: any,
  context: TransitionEvaluationContext
): Promise<TransitionEvaluationResult> {
  try {
    // If no condition specified, transition is always valid
    if (!transition.condition) {
      return {
        isValid: true,
      }
    }

    // Build data context for rule evaluation
    const data = {
      ...instance.context,
      ...context.workflowContext,
      triggerData: context.triggerData,
    }

    // Build evaluation context
    const evalContext: ruleEvaluator.RuleEvaluationContext = {
      entityType: 'workflow:transition',
      entityId: instance.id,
      user: context.userId ? { id: context.userId } : undefined,
    }

    // Evaluate condition using expression evaluator
    const result = await ruleEvaluator.evaluateConditions(
      transition.condition,
      data,
      evalContext
    )

    return {
      isValid: result,
      reason: result ? undefined : 'Transition condition evaluated to false',
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      isValid: false,
      reason: `Condition evaluation error: ${errorMessage}`,
    }
  }
}

/**
 * Evaluate pre-conditions using business rules engine
 *
 * Pre-conditions are GUARD rules that must pass before transition can execute.
 * If any GUARD rule fails, the transition is blocked.
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param transition - Transition definition
 * @param context - Execution context
 * @returns Rule engine result
 */
async function evaluatePreConditions(
  em: EntityManager,
  instance: WorkflowInstance,
  transition: any,
  context: TransitionExecutionContext
): Promise<ruleEngine.RuleEngineResult> {
  try {
    // Load workflow definition to get workflow ID
    const definition = await em.findOne(WorkflowDefinition, {
      id: instance.definitionId,
    })

    if (!definition) {
      return {
        allowed: true,
        executedRules: [],
        totalExecutionTime: 0,
      }
    }

    // Build rule engine context
    const ruleContext: RuleEngineContext = {
      entityType: `workflow:${definition.workflowId}:transition`,
      entityId: transition.transitionId || `${transition.fromStepId}->${transition.toStepId}`,
      eventType: 'pre_transition',
      data: {
        workflowInstanceId: instance.id,
        workflowId: definition.workflowId,
        fromStepId: transition.fromStepId,
        toStepId: transition.toStepId,
        workflowContext: {
          ...instance.context,
          ...context.workflowContext,
        },
        triggerData: context.triggerData,
      },
      user: context.userId ? { id: context.userId } : undefined,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      executedBy: context.userId,
    }

    console.log('[PRE-CONDITIONS] Rule engine context:', {
      entityType: ruleContext.entityType,
      entityId: ruleContext.entityId,
      eventType: ruleContext.eventType,
      dataKeys: Object.keys(ruleContext.data),
      workflowContextKeys: Object.keys(ruleContext.data.workflowContext),
    })

    // Execute rules - only GUARD rules will affect the 'allowed' status
    const result = await ruleEngine.executeRules(em, ruleContext)

    return result
  } catch (error) {
    console.error('Error evaluating pre-conditions:', error)
    return {
      allowed: false,
      executedRules: [],
      totalExecutionTime: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/**
 * Evaluate post-conditions using business rules engine
 *
 * Post-conditions are GUARD rules that should pass after transition executes.
 * Unlike pre-conditions, post-condition failures are logged but don't block the transition.
 *
 * @param em - Entity manager
 * @param instance - Workflow instance
 * @param transition - Transition definition
 * @param context - Execution context
 * @returns Rule engine result
 */
async function evaluatePostConditions(
  em: EntityManager,
  instance: WorkflowInstance,
  transition: any,
  context: TransitionExecutionContext
): Promise<ruleEngine.RuleEngineResult> {
  try {
    // Load workflow definition to get workflow ID
    const definition = await em.findOne(WorkflowDefinition, {
      id: instance.definitionId,
    })

    if (!definition) {
      return {
        allowed: true,
        executedRules: [],
        totalExecutionTime: 0,
      }
    }

    // Build rule engine context
    const ruleContext: RuleEngineContext = {
      entityType: `workflow:${definition.workflowId}:transition`,
      entityId: transition.transitionId || `${transition.fromStepId}->${transition.toStepId}`,
      eventType: 'post_transition',
      data: {
        workflowInstanceId: instance.id,
        workflowId: definition.workflowId,
        fromStepId: transition.fromStepId,
        toStepId: transition.toStepId,
        workflowContext: {
          ...instance.context,
          ...context.workflowContext,
        },
        triggerData: context.triggerData,
      },
      user: context.userId ? { id: context.userId } : undefined,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      executedBy: context.userId,
    }

    // Execute rules
    const result = await ruleEngine.executeRules(em, ruleContext)

    return result
  } catch (error) {
    console.error('Error evaluating post-conditions:', error)
    return {
      allowed: false,
      executedRules: [],
      totalExecutionTime: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log transition-related event to event sourcing table
 */
async function logTransitionEvent(
  em: EntityManager,
  event: {
    workflowInstanceId: string
    eventType: string
    eventData: any
    userId?: string
    tenantId: string
    organizationId: string
  }
): Promise<WorkflowEvent> {
  const workflowEvent = em.create(WorkflowEvent, {
    ...event,
    occurredAt: new Date(),
  })

  await em.persistAndFlush(workflowEvent)
  return workflowEvent
}
