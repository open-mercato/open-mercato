'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Search, X, Loader2, AlertCircle, Workflow } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { WorkflowSelector, type WorkflowDefinition } from '../WorkflowSelector'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

interface WorkflowSelectorFieldProps extends CrudCustomFieldRenderProps {
  value: string
  label?: string
  description?: string
}

interface WorkflowDetails {
  workflowId: string
  workflowName?: string
  version?: number
  enabled?: boolean
  description?: string | null
  loading?: boolean
  error?: boolean
}

/**
 * WorkflowSelectorField - Custom field component for selecting a sub-workflow
 *
 * Integrates with WorkflowSelector modal to pick a workflow.
 * Fetches and displays workflow details for the selected workflow ID.
 * Allows clearing the selection.
 *
 * Used by NodeEditDialog (SubWorkflow type only)
 */
export function WorkflowSelectorField({
  id,
  value = '',
  error,
  setValue,
  disabled,
  label = 'Sub-Workflow',
  description = 'Select a workflow to invoke as a sub-workflow',
}: WorkflowSelectorFieldProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [workflowDetails, setWorkflowDetails] = useState<WorkflowDetails | null>(null)

  const workflowId = value || ''

  // Fetch workflow details when workflowId changes
  useEffect(() => {
    if (workflowId) {
      setWorkflowDetails({ workflowId, loading: true })
      fetchWorkflowDetails(workflowId)
    } else {
      setWorkflowDetails(null)
    }
  }, [workflowId])

  const fetchWorkflowDetails = async (wfId: string) => {
    try {
      const params = new URLSearchParams({ workflowId: wfId, limit: '1' })
      const response = await apiFetch(`/api/workflows/definitions?${params.toString()}`)

      if (response.ok) {
        const result = await response.json()
        const workflow = result.data?.[0] as WorkflowDefinition | undefined

        setWorkflowDetails({
          workflowId: wfId,
          workflowName: workflow?.workflowName,
          version: workflow?.version,
          enabled: workflow?.enabled,
          description: workflow?.description,
          loading: false,
          error: !workflow,
        })
      } else {
        setWorkflowDetails({
          workflowId: wfId,
          loading: false,
          error: true,
        })
      }
    } catch (err) {
      console.error(`Failed to fetch workflow details for ${wfId}:`, err)
      setWorkflowDetails({
        workflowId: wfId,
        loading: false,
        error: true,
      })
    }
  }

  const handleSelect = (selectedWorkflowId: string, _workflow: WorkflowDefinition) => {
    setValue(selectedWorkflowId)
    setIsModalOpen(false)
  }

  const handleClear = () => {
    if (typeof window !== 'undefined' && !window.confirm('Are you sure you want to clear the selected workflow?')) {
      return
    }
    setValue('')
    setWorkflowDetails(null)
  }

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          {description}
        </p>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>

      {!workflowId ? (
        /* No Workflow Selected */
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
          <Workflow className="size-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">No workflow selected</p>
          <Button
            type="button"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            disabled={disabled}
          >
            <Search className="size-3 mr-1" />
            Browse Workflows
          </Button>
        </div>
      ) : (
        /* Workflow Selected */
        <div className="border border-gray-200 rounded-lg bg-white p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 space-y-2">
              {workflowDetails?.loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading workflow details...</span>
                </div>
              ) : workflowDetails?.error ? (
                <>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-yellow-600" />
                    <span className="text-sm font-semibold text-gray-900">{workflowId}</span>
                  </div>
                  <p className="text-xs text-yellow-600">Workflow not found or unavailable</p>
                </>
              ) : (
                <>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {workflowDetails?.workflowName || workflowId}
                      </span>
                      {workflowDetails?.version !== undefined && (
                        <Badge variant="secondary" className="text-xs">
                          v{workflowDetails.version}
                        </Badge>
                      )}
                      {workflowDetails?.enabled !== undefined && (
                        workflowDetails.enabled ? (
                          <Badge variant="default" className="bg-emerald-500 text-xs">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Disabled
                          </Badge>
                        )
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{workflowId}</p>
                  </div>
                  {workflowDetails?.description && (
                    <p className="text-xs text-muted-foreground">{workflowDetails.description}</p>
                  )}
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsModalOpen(true)}
                disabled={disabled}
              >
                <Search className="size-3 mr-1" />
                Change
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={disabled}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Workflow Selector Modal */}
      <WorkflowSelector
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={handleSelect}
        excludeWorkflowIds={workflowId ? [workflowId] : []}
        title="Select Sub-Workflow"
        description="Choose a workflow to invoke as a sub-workflow"
        onlyEnabled={true}
      />
    </div>
  )
}
