'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Plus, Loader2, AlertCircle, Workflow } from 'lucide-react'

export interface WorkflowDefinition {
  id: string
  workflowId: string
  workflowName: string
  description: string | null
  version: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface WorkflowSelectorProps {
  /** Whether the dialog is open */
  isOpen: boolean

  /** Callback when dialog is closed */
  onClose: () => void

  /** Callback when a workflow is selected */
  onSelect: (workflowId: string, workflow: WorkflowDefinition) => void

  /** Array of workflow IDs to exclude from the list (already selected) */
  excludeWorkflowIds?: string[]

  /** Dialog title */
  title?: string

  /** Dialog description */
  description?: string

  /** Whether to show only enabled workflows */
  onlyEnabled?: boolean

  /** Custom empty state message */
  emptyMessage?: string

  /** Custom search placeholder */
  searchPlaceholder?: string
}

/**
 * WorkflowSelector - Reusable dialog for searching and selecting workflow definitions
 *
 * Features:
 * - Search/filter workflows by name, ID, description
 * - Display workflow details (version, enabled status, description)
 * - Exclude already-selected workflows
 * - Loading and error states
 * - Responsive grid layout
 */
export function WorkflowSelector({
  isOpen,
  onClose,
  onSelect,
  excludeWorkflowIds = [],
  title = 'Select Workflow',
  description = 'Choose a workflow to invoke as a sub-workflow',
  onlyEnabled = true,
  emptyMessage,
  searchPlaceholder = 'Search by workflow ID, name, or description...',
}: WorkflowSelectorProps) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch workflows on mount
  useEffect(() => {
    if (isOpen) {
      fetchWorkflows()
    }
  }, [isOpen])

  const fetchWorkflows = async () => {
    setLoading(true)
    setError(null)
    try {
      // Build query params
      const params = new URLSearchParams()
      params.set('limit', '50') // Reasonable limit for selector

      if (onlyEnabled) {
        params.set('enabled', 'true')
      }

      const url = `/api/workflows/definitions?${params.toString()}`
      const response = await apiFetch(url)

      if (response.ok) {
        const result = await response.json()
        setWorkflows(result.data || [])
      } else {
        let errorMessage = `Failed to load workflows (${response.status})`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          // Use default error message
        }
        console.error('Failed to fetch workflows:', {
          url,
          status: response.status,
          error: errorMessage,
        })
        setError(errorMessage)
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err)
      const errorMessage = err instanceof Error ? err.message : 'Network error loading workflows'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Filter workflows based on search query and exclusions
  const getFilteredWorkflows = (): WorkflowDefinition[] => {
    return workflows
      .filter(wf => !excludeWorkflowIds.includes(wf.workflowId))
      .filter(wf => {
        if (!searchQuery) return true
        const query = searchQuery.toLowerCase()
        return (
          wf.workflowName.toLowerCase().includes(query) ||
          wf.workflowId.toLowerCase().includes(query) ||
          wf.description?.toLowerCase().includes(query)
        )
      })
  }

  const handleSelect = (workflow: WorkflowDefinition) => {
    onSelect(workflow.workflowId, workflow)
    setSearchQuery('') // Clear search on select
  }

  const handleClose = () => {
    setSearchQuery('')
    onClose()
  }

  const filteredWorkflows = getFilteredWorkflows()

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-6">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
            disabled={loading}
          />
        </div>

        {/* Workflows List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[400px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground text-sm">Loading workflows...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-16 w-16 text-destructive mb-4" />
              <p className="text-destructive text-sm font-medium mb-2">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchWorkflows}
              >
                Retry
              </Button>
            </div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Workflow className="w-16 h-16 text-muted mb-4" />
              <p className="text-muted-foreground text-sm mb-2">
                {emptyMessage || (
                  searchQuery
                    ? 'No workflows found matching your search'
                    : workflows.length === 0
                    ? 'No workflows exist yet'
                    : 'All workflows have already been excluded'
                )}
              </p>
              <p className="text-muted-foreground text-xs mb-3">
                {workflows.length === 0
                  ? 'Create workflows in the Workflow Definitions page first'
                  : searchQuery
                  ? `Showing 0 of ${workflows.length} total workflows`
                  : `${workflows.length} workflows already excluded`
                }
              </p>
              {searchQuery && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                >
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 text-sm text-muted-foreground">
                {filteredWorkflows.length} workflow{filteredWorkflows.length !== 1 ? 's' : ''} available
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredWorkflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    onClick={() => handleSelect(workflow)}
                    className="text-left p-4 border-2 border-border rounded-lg hover:border-primary hover:bg-accent transition-all group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold group-hover:text-primary truncate">
                          {workflow.workflowName}
                        </h4>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          {workflow.workflowId}
                        </p>
                      </div>
                      <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                    </div>

                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        v{workflow.version}
                      </Badge>
                      {workflow.enabled ? (
                        <Badge variant="default" className="bg-emerald-500 text-xs">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Disabled
                        </Badge>
                      )}
                    </div>

                    {workflow.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {workflow.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
