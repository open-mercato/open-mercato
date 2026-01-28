"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { emitSalesDocumentDataRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentDataEvents'

type OrderRecord = {
  id: string
  orderNumber?: string
  status?: string
  statusEntryId?: string
}

type WorkflowInstance = {
  id: string
  workflowId: string
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'WAITING_FOR_ACTIVITIES'
  currentStepId: string
  context: Record<string, any>
}

type UserTask = {
  id: string
  taskName: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  workflowInstanceId: string
  claimedBy: string | null
}

type DictionaryEntry = {
  id: string
  value: string
  label: string
  color?: string
  icon?: string
}

const WORKFLOW_ID = 'sales_order_approval_v1'

export default function OrderApprovalWidget({ data }: InjectionWidgetComponentProps<unknown, OrderRecord>) {
  const t = useT()
  const queryClient = useQueryClient()
  const orderId = data?.id

  const [decision, setDecision] = React.useState<'approve' | 'reject' | ''>('')
  const [comments, setComments] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  // Track if we're waiting for workflow to process (for polling)
  const [isWaitingForProcessing, setIsWaitingForProcessing] = React.useState(false)

  // Fetch current order status directly (to detect when workflow updates it)
  // Use list endpoint with ID filter since single-item endpoint doesn't exist
  const { data: orderData } = useQuery({
    queryKey: ['order-status', orderId],
    queryFn: async () => {
      if (!orderId) return null
      const result = await apiCall<{ items: Array<{ id: string; status?: string | null }> }>(
        `/api/sales/orders?id=${orderId}&pageSize=1`
      )
      return result.ok && result.result?.items?.[0] ? result.result.items[0] : null
    },
    enabled: Boolean(orderId),
    staleTime: 5_000,
    // Poll when waiting for processing to detect status change
    refetchInterval: isWaitingForProcessing ? 2_000 : false,
  })

  // Use fresh order status from query, fallback to prop data
  // The API returns status as a string value (e.g., "approved", "pending_approval")
  const currentOrderStatus = orderData?.status || data?.status

  // Fetch active workflow instances for this order
  const { data: instancesData, isLoading: instancesLoading } = useQuery({
    queryKey: ['workflow-instances', orderId],
    queryFn: async () => {
      if (!orderId) return { data: [] }
      const result = await apiCall<{ data: WorkflowInstance[] }>(
        `/api/workflows/instances?entityId=${orderId}&status=RUNNING,PAUSED,WAITING_FOR_ACTIVITIES`
      )
      return result.ok ? result.result : { data: [] }
    },
    enabled: Boolean(orderId),
    staleTime: 5_000,
    // Poll every 2 seconds when waiting for processing
    refetchInterval: isWaitingForProcessing ? 2_000 : false,
  })

  const activeInstance = instancesData?.data?.find(
    (inst) => inst.workflowId === WORKFLOW_ID && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(inst.status)
  )

  // Fetch pending user tasks for active instance
  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['workflow-tasks', activeInstance?.id],
    queryFn: async () => {
      if (!activeInstance?.id) return { data: [] }
      const result = await apiCall<{ data: UserTask[] }>(
        `/api/workflows/tasks?workflowInstanceId=${activeInstance.id}&status=PENDING,IN_PROGRESS`
      )
      return result.ok ? result.result : { data: [] }
    },
    enabled: Boolean(activeInstance?.id),
    staleTime: 5_000,
    // Poll every 2 seconds when waiting for processing
    refetchInterval: isWaitingForProcessing ? 2_000 : false,
  })

  const pendingTask = tasksData?.data?.[0]

  // Auto-detect when workflow is processing (active instance but no pending task)
  const isProcessing = activeInstance && !pendingTask && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(activeInstance.status)

  // Track previous status to detect changes
  const prevStatusRef = React.useRef<string | undefined>(data?.status)

  // Update polling state when processing state changes
  React.useEffect(() => {
    if (isProcessing) {
      setIsWaitingForProcessing(true)
    } else if (!activeInstance || activeInstance.status === 'COMPLETED') {
      setIsWaitingForProcessing(false)
    }
  }, [isProcessing, activeInstance])

  // When order status changes, emit refresh event to update the page
  React.useEffect(() => {
    const newStatus = orderData?.status
    const oldStatus = prevStatusRef.current

    if (newStatus && oldStatus && newStatus !== oldStatus) {
      // Status changed - emit document refresh event to reload the page data
      if (orderId) {
        emitSalesDocumentDataRefresh({ documentId: orderId, kind: 'order' })
      }
    }

    prevStatusRef.current = newStatus || oldStatus
  }, [orderData?.status, orderId])

  // First fetch dictionaries to find the order_status dictionary ID
  const { data: dictionariesData } = useQuery({
    queryKey: ['dictionaries'],
    queryFn: async () => {
      const result = await apiCall<{ items: Array<{ id: string; key: string }> }>(
        '/api/dictionaries'
      )
      return result.ok ? result.result : { items: [] }
    },
    staleTime: 60_000,
  })

  const orderStatusDictionaryId = React.useMemo(() => {
    const dict = dictionariesData?.items?.find(d => d.key === 'sales.order_status')
    return dict?.id
  }, [dictionariesData])

  // Fetch order status dictionary entries using the dictionary ID
  const { data: statusEntriesData } = useQuery({
    queryKey: ['dictionary-entries', orderStatusDictionaryId],
    queryFn: async () => {
      if (!orderStatusDictionaryId) return { items: [] }
      const result = await apiCall<{ items: DictionaryEntry[] }>(
        `/api/dictionaries/${orderStatusDictionaryId}/entries`
      )
      return result.ok ? result.result : { items: [] }
    },
    enabled: Boolean(orderStatusDictionaryId),
    staleTime: 60_000,
  })

  const findStatusId = React.useCallback((code: string) => {
    const entries = statusEntriesData?.items || []
    // The API returns 'value' as the code/key for dictionary entries
    const entry = entries.find(
      (e) => e.value === code || e.label?.toLowerCase() === code.toLowerCase()
    )
    return entry?.id
  }, [statusEntriesData])

  // Start workflow mutation
  const startWorkflowMutation = useMutation({
    mutationFn: async () => {
      const pendingApprovalStatusId = findStatusId('pending_approval')
      const approvedStatusId = findStatusId('approved')
      const rejectedStatusId = findStatusId('rejected')

      if (!pendingApprovalStatusId || !approvedStatusId || !rejectedStatusId) {
        throw new Error(t('workflows.orderApproval.missingStatuses', 'Missing order status entries. Please ensure pending_approval, approved, and rejected statuses exist in the sales.order_status dictionary.'))
      }

      const result = await apiCall<{ data: WorkflowInstance }>('/api/workflows/instances', {
        method: 'POST',
        body: JSON.stringify({
          workflowId: WORKFLOW_ID,
          initialContext: {
            orderId,
            pendingApprovalStatusId,
            approvedStatusId,
            rejectedStatusId,
          },
          metadata: {
            entityType: 'SalesOrder',
            entityId: orderId,
          },
        }),
      })

      if (!result.ok) {
        const errorResult = result.result as { error?: string } | null
        throw new Error(errorResult?.error || t('workflows.orderApproval.startError', 'Failed to start approval workflow'))
      }

      return result.result
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['workflow-instances', orderId] })
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: async ({ taskId, formData }: { taskId: string; formData: { decision: string; comments?: string } }) => {
      const result = await apiCall(`/api/workflows/tasks/${taskId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ formData }),
      })

      if (!result.ok) {
        const errorResult = result.result as { error?: string } | null
        throw new Error(errorResult?.error || t('workflows.orderApproval.completeError', 'Failed to complete approval task'))
      }

      return result.result
    },
    onSuccess: () => {
      setError(null)
      setDecision('')
      setComments('')
      // Start polling immediately after submitting decision
      setIsWaitingForProcessing(true)
      queryClient.invalidateQueries({ queryKey: ['workflow-instances', orderId] })
      queryClient.invalidateQueries({ queryKey: ['workflow-tasks', activeInstance?.id] })
      // Also refresh the order data
      queryClient.invalidateQueries({ queryKey: ['sales-order', orderId] })
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleStartWorkflow = () => {
    // Start polling after starting workflow
    setIsWaitingForProcessing(true)
    startWorkflowMutation.mutate()
  }

  const handleCompleteTask = () => {
    if (!pendingTask || !decision) return
    completeTaskMutation.mutate({
      taskId: pendingTask.id,
      formData: { decision, comments },
    })
  }

  // Handle keyboard shortcuts (Cmd/Ctrl+Enter to submit)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (pendingTask && decision && !isSubmitting) {
        handleCompleteTask()
      }
    }
  }

  const isLoading = instancesLoading || tasksLoading
  const isSubmitting = startWorkflowMutation.isPending || completeTaskMutation.isPending

  // Don't render if no orderId
  if (!orderId) return null

  // Only show widget when order status is pending_approval
  const orderStatus = currentOrderStatus?.toLowerCase()
  if (orderStatus !== 'pending_approval') {
    return null
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner size="sm" />
        <span className="ml-2 text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</span>
      </div>
    )
  }

  // Show workflow status badge
  const getStatusBadge = () => {
    if (!activeInstance) return null

    const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      RUNNING: 'default',
      PAUSED: 'secondary',
      WAITING_FOR_ACTIVITIES: 'secondary',
      COMPLETED: 'default',
      FAILED: 'destructive',
      CANCELLED: 'outline',
    }

    return (
      <Badge variant={statusVariants[activeInstance.status] || 'outline'}>
        {t(`workflows.instances.statuses.${activeInstance.status}`, activeInstance.status)}
      </Badge>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t('workflows.orderApproval.groupLabel', 'Order Approval')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('workflows.orderApproval.groupDescription', 'Review and approve or reject this order')}
          </p>
        </div>
        {getStatusBadge()}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* No active workflow - show request approval button */}
      {!activeInstance && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('workflows.orderApproval.noWorkflowActive', 'No approval workflow is active for this order.')}
          </p>
          <Button
            onClick={handleStartWorkflow}
            disabled={isSubmitting}
            variant="default"
            size="sm"
          >
            {isSubmitting && <Spinner size="sm" className="mr-2" />}
            {t('workflows.orderApproval.requestApproval', 'Request Approval')}
          </Button>
        </div>
      )}

      {/* Active workflow with pending task - show approve/reject UI */}
      {activeInstance && pendingTask && (
        <div className="space-y-3" onKeyDown={handleKeyDown}>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">
              {t('workflows.orderApproval.pendingTitle', 'Pending Approval')}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {t('workflows.orderApproval.pendingDescription', 'This order requires approval before processing.')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('workflows.orderApproval.decisionLabel', 'Decision')}
            </label>
            <div className="flex gap-2">
              <Button
                variant={decision === 'approve' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDecision('approve')}
                className={decision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              >
                {t('workflows.orderApproval.approveButton', 'Approve')}
              </Button>
              <Button
                variant={decision === 'reject' ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => setDecision('reject')}
              >
                {t('workflows.orderApproval.rejectButton', 'Reject')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('workflows.orderApproval.commentsLabel', 'Comments')} <span className="text-muted-foreground font-normal">({t('common.optional', 'optional')})</span>
            </label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={t('workflows.orderApproval.commentsPlaceholder', 'Add optional comments...')}
              rows={2}
            />
          </div>

          <Button
            onClick={handleCompleteTask}
            disabled={!decision || isSubmitting}
            variant="default"
            size="sm"
            className="w-full"
          >
            {isSubmitting && <Spinner size="sm" className="mr-2" />}
            {t('workflows.orderApproval.submitDecision', 'Submit Decision')}
          </Button>
        </div>
      )}

      {/* Active workflow but no pending task (processing) */}
      {activeInstance && !pendingTask && activeInstance.status !== 'COMPLETED' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <p className="text-sm text-blue-800">
            {t('workflows.orderApproval.processing', 'Workflow is processing...')}
          </p>
        </div>
      )}

      {/* Completed workflow */}
      {activeInstance && activeInstance.status === 'COMPLETED' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-800">
            {t('workflows.orderApproval.completed', 'Approval workflow completed.')}
          </p>
        </div>
      )}
    </div>
  )
}
