'use client'

import { useState, useEffect } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Plus, Workflow } from 'lucide-react'

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


export function WorkflowSelector({
  isOpen, onClose, onSelect, excludeWorkflowIds = [], title, description,
  onlyEnabled = true, emptyMessage, searchPlaceholder,
}: WorkflowSelectorProps) {
  const t = useT()
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setWorkflows([])
    const load = async () => {
      try {
        const items: WorkflowDefinition[] = []
        let offset = 0
        while (!cancelled) {
          const params = new URLSearchParams({ limit: '100', offset: String(offset) })
          if (onlyEnabled) params.set('enabled', 'true')
          const response = await apiCall<{ data?: WorkflowDefinition[]; pagination?: { hasMore?: boolean } }>(
            `/api/workflows/definitions?${params}`, undefined, { fallback: {} },
          )
          if (cancelled) return
          if (!response.ok || !Array.isArray(response.result?.data)) {
            setFailed(true)
            return
          }
          items.push(...response.result.data.filter((item) => typeof item?.workflowId === 'string'))
          if (!response.result.pagination?.hasMore || response.result.data.length === 0) break
          offset += 100
        }
        if (!cancelled) setWorkflows(items)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isOpen, onlyEnabled, retry])

  const query = searchQuery.trim().toLocaleLowerCase()
  const filtered = workflows.filter((workflow) =>
    !excludeWorkflowIds.includes(workflow.workflowId)
    && [workflow.workflowId, workflow.workflowName, workflow.description]
      .some((part) => typeof part === 'string' && part.toLocaleLowerCase().includes(query)),
  )
  const handleClose = () => { setSearchQuery(''); onClose() }

  return (
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DrawerContent data-testid="workflow-selector-drawer" className="w-full max-w-none sm:w-3/5" closeAriaLabel={t('workflows.selectors.workflow.close')}>
        <DrawerHeader>
          <DrawerTitle>{title ?? t('workflows.selectors.workflow.title')}</DrawerTitle>
          <DrawerDescription>{description ?? t('workflows.fieldEditors.workflowSelector.selectSubWorkflowDescription')}</DrawerDescription>
        </DrawerHeader>
        <div className="px-6">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={searchPlaceholder ?? t('workflows.selectors.workflow.search')}
            aria-label={searchPlaceholder ?? t('workflows.selectors.workflow.search')}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          />
        </div>
        <DrawerBody className="py-4">
          {loading ? <LoadingMessage label={t('workflows.common.loading')} /> : failed ? (
            <ErrorMessage label={t('workflows.messages.loadFailed')} action={
              <Button type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>{t('workflows.commandSettings.retry')}</Button>
            } />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Workflow />} title={emptyMessage ?? t(query ? 'workflows.selectors.workflow.noMatches' : 'workflows.selectors.workflow.empty')} actions={query ? (
              <Button type="button" variant="outline" onClick={() => setSearchQuery('')}>{t('workflows.selectors.workflow.clearSearch')}</Button>
            ) : undefined} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map((workflow) => (
                <Button
                  key={workflow.id}
                  type="button"
                  variant="outline"
                  className="group h-auto min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal rounded-lg border-2 p-4 text-left font-normal hover:border-primary"
                  onClick={() => { onSelect(workflow.workflowId, workflow); setSearchQuery('') }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      event.stopPropagation()
                      onSelect(workflow.workflowId, workflow)
                      setSearchQuery('')
                    }
                  }}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold">{workflow.workflowName || workflow.workflowId}</span>
                      <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{workflow.workflowId}</span>
                    </span>
                    <Plus className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="secondary">v{workflow.version}</Badge>
                    <Badge variant="outline">{t(workflow.enabled ? 'common.enabled' : 'common.disabled')}</Badge>
                  </span>
                  {workflow.description ? <span className="line-clamp-3 break-words text-xs text-muted-foreground" title={workflow.description}>{workflow.description}</span> : null}
                </Button>
              ))}
            </div>
          )}
        </DrawerBody>
        <DrawerFooter><Button type="button" variant="outline" onClick={handleClose}>{t('workflows.common.cancel')}</Button></DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
