import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WorkflowDefinition, WorkflowInstance } from '../../workflows/data/entities'
import { startWorkflow } from '../../workflows/lib/workflow-executor'
import { executeTransition } from '../../workflows/lib/transition-handler'
import type {
  EcommerceCheckoutSession,
  EcommerceCheckoutWorkflowState,
} from '../data/entities'
import type { CheckoutTransitionAction } from '../data/validators'

export const STOREFRONT_CHECKOUT_WORKFLOW_ID = 'ecommerce_checkout_v1'
const STOREFRONT_CHECKOUT_WORKFLOW_NAME = 'Ecommerce Checkout v1'

type Scope = {
  tenantId: string
  organizationId: string
}

const CHECKOUT_WORKFLOW_DEFINITION = {
  steps: [
    { stepId: 'cart', stepName: 'Cart', stepType: 'START' },
    { stepId: 'customer', stepName: 'Customer', stepType: 'AUTOMATED' },
    { stepId: 'shipping', stepName: 'Shipping', stepType: 'AUTOMATED' },
    { stepId: 'review', stepName: 'Review', stepType: 'AUTOMATED' },
    { stepId: 'placing_order', stepName: 'Placing Order', stepType: 'AUTOMATED' },
    { stepId: 'completed', stepName: 'Completed', stepType: 'END' },
    { stepId: 'failed', stepName: 'Failed', stepType: 'END' },
    { stepId: 'cancelled', stepName: 'Cancelled', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'cart_to_customer', fromStepId: 'cart', toStepId: 'customer', trigger: 'manual', priority: 100 },
    { transitionId: 'customer_to_customer', fromStepId: 'customer', toStepId: 'customer', trigger: 'manual', priority: 100 },
    { transitionId: 'customer_to_shipping', fromStepId: 'customer', toStepId: 'shipping', trigger: 'manual', priority: 90 },
    { transitionId: 'customer_to_review', fromStepId: 'customer', toStepId: 'review', trigger: 'manual', priority: 80 },
    { transitionId: 'shipping_to_shipping', fromStepId: 'shipping', toStepId: 'shipping', trigger: 'manual', priority: 100 },
    { transitionId: 'shipping_to_review', fromStepId: 'shipping', toStepId: 'review', trigger: 'manual', priority: 90 },
    { transitionId: 'review_to_review', fromStepId: 'review', toStepId: 'review', trigger: 'manual', priority: 100 },
    { transitionId: 'review_to_placing_order', fromStepId: 'review', toStepId: 'placing_order', trigger: 'manual', priority: 100 },
    { transitionId: 'placing_order_to_completed', fromStepId: 'placing_order', toStepId: 'completed', trigger: 'manual', priority: 100 },
    { transitionId: 'placing_order_to_failed', fromStepId: 'placing_order', toStepId: 'failed', trigger: 'manual', priority: 100 },
    { transitionId: 'cart_to_cancelled', fromStepId: 'cart', toStepId: 'cancelled', trigger: 'manual', priority: 50 },
    { transitionId: 'customer_to_cancelled', fromStepId: 'customer', toStepId: 'cancelled', trigger: 'manual', priority: 50 },
    { transitionId: 'shipping_to_cancelled', fromStepId: 'shipping', toStepId: 'cancelled', trigger: 'manual', priority: 50 },
    { transitionId: 'review_to_cancelled', fromStepId: 'review', toStepId: 'cancelled', trigger: 'manual', priority: 50 },
  ],
} as const

function sessionMetadata(session: EcommerceCheckoutSession): Record<string, unknown> {
  return (session.metadata ?? {}) as Record<string, unknown>
}

function workflowInstanceIdFromSession(session: EcommerceCheckoutSession): string | null {
  const metadata = sessionMetadata(session)
  const value = metadata.workflowInstanceId
  return typeof value === 'string' && value.trim() ? value : null
}

function setWorkflowMetadata(
  session: EcommerceCheckoutSession,
  workflowInstanceId: string,
): void {
  const metadata = sessionMetadata(session)
  session.metadata = {
    ...metadata,
    workflowId: STOREFRONT_CHECKOUT_WORKFLOW_ID,
    workflowInstanceId,
  }
}

function stateFromStepId(stepId: string): EcommerceCheckoutWorkflowState {
  switch (stepId) {
    case 'cart':
    case 'customer':
    case 'shipping':
    case 'review':
    case 'placing_order':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return stepId
    default:
      return 'cart'
  }
}

export function resolveCheckoutTransitionTarget(
  action: CheckoutTransitionAction,
  currentStepId: string,
): string | null {
  if (action === 'set_customer') {
    if (currentStepId === 'cart' || currentStepId === 'customer') return 'customer'
    return null
  }
  if (action === 'set_shipping') {
    if (currentStepId === 'customer' || currentStepId === 'shipping') return 'shipping'
    return null
  }
  if (action === 'review') {
    if (currentStepId === 'customer' || currentStepId === 'shipping' || currentStepId === 'review') return 'review'
    return null
  }
  if (action === 'cancel') {
    if (currentStepId === 'cart' || currentStepId === 'customer' || currentStepId === 'shipping' || currentStepId === 'review') {
      return 'cancelled'
    }
    return null
  }
  if (action === 'place_order') {
    if (currentStepId === 'review') return 'placing_order'
    return null
  }
  return null
}

export async function ensureCheckoutWorkflowDefinition(
  em: EntityManager,
  scope: Scope,
): Promise<WorkflowDefinition> {
  const existing = await em.findOne(WorkflowDefinition, {
    workflowId: STOREFRONT_CHECKOUT_WORKFLOW_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (existing) return existing

  const created = em.create(WorkflowDefinition, {
    workflowId: STOREFRONT_CHECKOUT_WORKFLOW_ID,
    workflowName: STOREFRONT_CHECKOUT_WORKFLOW_NAME,
    description: 'State machine for storefront checkout session transitions.',
    version: 1,
    enabled: true,
    definition: CHECKOUT_WORKFLOW_DEFINITION,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  try {
    await em.persistAndFlush(created)
    return created
  } catch {
    const reloaded = await em.findOne(WorkflowDefinition, {
      workflowId: STOREFRONT_CHECKOUT_WORKFLOW_ID,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!reloaded) throw new Error('Failed to ensure storefront checkout workflow definition')
    return reloaded
  }
}

export async function ensureCheckoutWorkflowInstance(
  em: EntityManager,
  session: EcommerceCheckoutSession,
): Promise<WorkflowInstance> {
  await ensureCheckoutWorkflowDefinition(em, {
    tenantId: session.tenantId,
    organizationId: session.organizationId,
  })

  const existingInstanceId = workflowInstanceIdFromSession(session)
  if (existingInstanceId) {
    const existingInstance = await em.findOne(WorkflowInstance, {
      id: existingInstanceId,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      deletedAt: null,
    })
    if (existingInstance) return existingInstance
  }

  const instance = await startWorkflow(em, {
    workflowId: STOREFRONT_CHECKOUT_WORKFLOW_ID,
    tenantId: session.tenantId,
    organizationId: session.organizationId,
    correlationKey: `checkout-session:${session.id}`,
    metadata: {
      entityType: 'EcommerceCheckoutSession',
      entityId: session.id,
    },
    initialContext: {
      checkoutSessionId: session.id,
      cartId: session.cartId,
      cartToken: session.cartToken,
      storeId: session.storeId,
    },
  })

  setWorkflowMetadata(session, instance.id)
  await em.flush()

  return instance
}

export async function applyCheckoutWorkflowAction(
  em: EntityManager,
  container: AwilixContainer,
  session: EcommerceCheckoutSession,
  action: CheckoutTransitionAction,
  extraContext?: Record<string, unknown>,
): Promise<{ ok: true; workflowInstance: WorkflowInstance } | { ok: false; error: string }> {
  const workflowInstance = await ensureCheckoutWorkflowInstance(em, session)
  const currentStepId = workflowInstance.currentStepId
  const targetStepId = resolveCheckoutTransitionTarget(action, currentStepId)

  if (!targetStepId) {
    return {
      ok: false,
      error: `Action "${action}" is not allowed in workflow step "${currentStepId}"`,
    }
  }

  const transitionResult = await executeTransition(
    em,
    container,
    workflowInstance,
    currentStepId,
    targetStepId,
    {
      workflowContext: {
        checkoutSessionId: session.id,
        cartId: session.cartId,
        cartToken: session.cartToken,
        storeId: session.storeId,
        ...extraContext,
      },
      triggerData: {
        action,
      },
    },
  )

  if (!transitionResult.success) {
    return {
      ok: false,
      error: transitionResult.error || 'Workflow transition failed',
    }
  }

  await em.refresh(workflowInstance)
  session.workflowState = stateFromStepId(workflowInstance.currentStepId)
  return { ok: true, workflowInstance }
}

export async function setCheckoutWorkflowTerminalState(
  em: EntityManager,
  container: AwilixContainer,
  session: EcommerceCheckoutSession,
  terminal: 'completed' | 'failed',
): Promise<{ ok: true; workflowInstance: WorkflowInstance } | { ok: false; error: string }> {
  const workflowInstance = await ensureCheckoutWorkflowInstance(em, session)
  if (workflowInstance.currentStepId !== 'placing_order') {
    return {
      ok: false,
      error: `Cannot set terminal state from workflow step "${workflowInstance.currentStepId}"`,
    }
  }

  const transitionResult = await executeTransition(
    em,
    container,
    workflowInstance,
    'placing_order',
    terminal,
    {
      workflowContext: {
        checkoutSessionId: session.id,
        cartId: session.cartId,
        cartToken: session.cartToken,
        storeId: session.storeId,
      },
      triggerData: {
        action: terminal,
      },
    },
  )

  if (!transitionResult.success) {
    return {
      ok: false,
      error: transitionResult.error || 'Workflow terminal transition failed',
    }
  }

  await em.refresh(workflowInstance)
  session.workflowState = stateFromStepId(workflowInstance.currentStepId)
  return { ok: true, workflowInstance }
}

