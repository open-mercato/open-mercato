/**
 * Workflows Module — Code-Based Workflow Definitions
 *
 * Demo workflows shipped with the workflows module.
 * These are auto-discovered by the generator and loaded into the in-memory registry.
 */

import { defineWorkflow, createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'

// ============================================================================
// Simple Approval Workflow
// ============================================================================

const simpleApproval = defineWorkflow({
  workflowId: 'workflows.simple-approval',
  workflowName: 'Simple Approval Workflow',
  description: 'Basic three-step approval workflow: Start → Approval → End',
  metadata: { category: 'Testing', tags: ['test', 'approval', 'simple'], icon: 'check-circle' },
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START', description: 'Initialize workflow' },
    {
      stepId: 'approval',
      stepName: 'Pending Approval',
      stepType: 'USER_TASK',
      description: 'Approve or reject request',
      userTaskConfig: { assignedTo: 'approver', slaDuration: 'PT1H' },
    },
    { stepId: 'end', stepName: 'Complete', stepType: 'END', description: 'Workflow complete' },
  ] as const,
  transitions: [
    {
      transitionId: 'start_to_approval',
      transitionName: 'Submit for Approval',
      fromStepId: 'start',
      toStepId: 'approval',
      trigger: 'auto',
      priority: 100,
      activities: [
        {
          activityId: 'notify_approver',
          activityName: 'Notify Approver',
          activityType: 'SEND_EMAIL',
          config: {
            to: '{{context.approver.email}}',
            subject: 'Approval Required: {{context.request.title}}',
            template: 'approval_request',
            data: {
              requestId: '{{context.request.id}}',
              title: '{{context.request.title}}',
              requester: '{{context.requester.name}}',
            },
          },
          timeout: 'PT10S',
          async: true,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 2000, backoffCoefficient: 2, maxIntervalMs: 20000 },
        },
        {
          activityId: 'emit_approval_requested',
          activityName: 'Emit Approval Requested Event',
          activityType: 'EMIT_EVENT',
          config: {
            eventType: 'approval.requested',
            payload: { requestId: '{{context.request.id}}', workflowInstanceId: '{{workflow.instanceId}}' },
          },
          async: true,
        },
      ],
    },
    {
      transitionId: 'approval_to_end',
      transitionName: 'Approval Decision',
      fromStepId: 'approval',
      toStepId: 'end',
      trigger: 'manual',
      priority: 100,
      activities: [
        {
          activityId: 'notify_requester',
          activityName: 'Notify Requester of Decision',
          activityType: 'SEND_EMAIL',
          config: {
            to: '{{context.requester.email}}',
            subject: 'Approval Decision: {{context.request.title}}',
            template: 'approval_decision',
            data: {
              requestId: '{{context.request.id}}',
              title: '{{context.request.title}}',
              decision: '{{task.result.approved}}',
              comments: '{{task.result.comments}}',
              approver: '{{task.completedBy}}',
            },
          },
          timeout: 'PT10S',
          async: true,
        },
        {
          activityId: 'emit_approval_completed',
          activityName: 'Emit Approval Completed Event',
          activityType: 'EMIT_EVENT',
          config: {
            eventType: 'approval.completed',
            payload: {
              requestId: '{{context.request.id}}',
              approved: '{{task.result.approved}}',
              approvedBy: '{{task.completedBy}}',
              timestamp: '{{now}}',
            },
          },
          async: true,
        },
      ],
    },
  ],
})

// ============================================================================
// Checkout Demo Workflow
// ============================================================================

const checkoutDemo = defineWorkflow({
  workflowId: 'workflows.checkout-demo',
  workflowName: 'Checkout with Payment Webhook',
  description: 'Realistic checkout workflow with signal-based payment confirmation',
  metadata: { category: 'E-commerce', tags: ['checkout', 'demo', 'payments', 'signals'], icon: 'ShoppingCart' },
  steps: [
    {
      stepId: 'start',
      stepName: 'Start',
      stepType: 'START',
      description: 'Checkout process initiated',
      preConditions: [{
        ruleId: 'workflow_checkout_cart_not_empty',
        required: true,
        validationMessage: {
          en: 'Your shopping cart is empty. Please add items before starting checkout.',
          pl: 'Twój koszyk jest pusty. Dodaj produkty przed rozpoczęciem zakupu.',
        },
      }],
    },
    { stepId: 'cart_validation', stepName: 'Cart Validation', stepType: 'AUTOMATED', description: 'Validate cart has items and inventory is available', timeout: 'PT10S' },
    {
      stepId: 'customer_info',
      stepName: 'Customer Information',
      stepType: 'USER_TASK',
      description: 'Collect customer shipping and contact information',
      userTaskConfig: {
        formSchema: {
          type: 'object',
          properties: {
            fullName: { type: 'string', title: 'Full Name', description: "Customer's full legal name" },
            email: { type: 'string', format: 'email', title: 'Email Address', description: 'Email for order confirmation' },
            phone: { type: 'string', title: 'Phone Number', description: 'Contact number for delivery' },
            comment: { type: 'string', title: 'Order Comment', maxLength: 500, description: 'Special instructions or notes' },
          },
          required: ['fullName', 'email'],
        },
        slaDuration: 'PT24H',
      },
    },
    { stepId: 'payment_initiation', stepName: 'Initiate Payment', stepType: 'AUTOMATED', description: 'Send payment request to payment provider', timeout: 'PT10S' },
    {
      stepId: 'wait_payment_confirmation',
      stepName: 'Wait for Payment Confirmation',
      stepType: 'WAIT_FOR_SIGNAL',
      description: 'Waiting for payment provider webhook confirmation',
      signalConfig: { signalName: 'payment_confirmed', timeout: 'PT5M' },
    },
    { stepId: 'order_confirmation', stepName: 'Order Confirmation', stepType: 'AUTOMATED', description: 'Create order record and send confirmation', timeout: 'PT15S' },
    { stepId: 'end', stepName: 'Complete', stepType: 'END', description: 'Checkout completed successfully' },
  ] as const,
  transitions: [
    {
      transitionId: 'start_to_cart',
      transitionName: 'Initialize Checkout',
      fromStepId: 'start',
      toStepId: 'cart_validation',
      trigger: 'auto',
      priority: 100,
      activities: [{
        activityId: 'log_checkout_start',
        activityName: 'Log Checkout Start',
        activityType: 'EMIT_EVENT',
        config: {
          eventName: 'checkout.started',
          payload: { customerId: '{{context.customerId}}', cartId: '{{context.cartId}}', currency: '{{context.currency}}', timestamp: '{{now}}' },
        },
        async: false,
      }],
    },
    {
      transitionId: 'cart_to_customer_info',
      transitionName: 'Collect Customer Information',
      fromStepId: 'cart_validation',
      toStepId: 'customer_info',
      trigger: 'auto',
      priority: 100,
      preConditions: [{ ruleId: 'workflow_checkout_cart_not_empty', required: true }],
    },
    {
      transitionId: 'customer_info_to_payment',
      transitionName: 'Initiate Payment',
      fromStepId: 'customer_info',
      toStepId: 'payment_initiation',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'payment_to_wait_confirmation',
      transitionName: 'Wait for Confirmation',
      fromStepId: 'payment_initiation',
      toStepId: 'wait_payment_confirmation',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'confirmation_to_order',
      transitionName: 'Payment Confirmed',
      fromStepId: 'wait_payment_confirmation',
      toStepId: 'order_confirmation',
      trigger: 'auto',
      priority: 100,
    },
    {
      transitionId: 'confirmation_to_end',
      transitionName: 'Finalize Order',
      fromStepId: 'order_confirmation',
      toStepId: 'end',
      trigger: 'auto',
      priority: 100,
      activities: [
        {
          activityId: 'create_order',
          activityName: 'Create Order Record',
          activityType: 'CALL_API',
          config: {
            endpoint: '/api/sales/orders',
            method: 'POST',
            body: {
              customerEntityId: '{{context.customer.id}}',
              currencyCode: '{{context.cart.currency}}',
              placedAt: '{{now}}',
              grandTotalGrossAmount: '{{context.cart.total}}',
            },
            validateTenantMatch: true,
          },
          timeout: 'PT10S',
          async: false,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 2000, backoffCoefficient: 2, maxIntervalMs: 10000 },
        },
        {
          activityId: 'send_confirmation_email',
          activityName: 'Send Order Confirmation Email',
          activityType: 'SEND_EMAIL',
          config: {
            to: '{{context.customer.email}}',
            subject: 'Order Confirmation',
            template: 'order_confirmation',
            data: { customerName: '{{context.customer.name}}', total: '{{context.cart.total}}' },
          },
          timeout: 'PT15S',
          async: true,
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 2000, backoffCoefficient: 2, maxIntervalMs: 20000 },
        },
      ],
    },
  ],
})

// ============================================================================
// Module Export
// ============================================================================

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'workflows',
  workflows: [simpleApproval, checkoutDemo],
})

export default workflowsConfig
