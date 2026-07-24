"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GitMerge, Link2, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type IncidentOptionRecord = {
  id: string
  number?: string | null
  title?: string | null
  status?: string | null
}

type IncidentOption = {
  id: string
  number: string
  title: string
  status: string | null
}

type IncidentOptionsResponse = {
  items?: IncidentOptionRecord[]
}

type LinkKind = 'related' | 'duplicate'

type LinkItem = {
  id: string
  kind: LinkKind | string
  direction: 'outgoing' | 'incoming'
  linkedIncident: {
    id: string
    number: string
    title: string
    status: string
    severityId: string
  }
}

type LinksResponse = {
  items?: LinkItem[]
  error?: string
}

type LinkMutationResponse = {
  ok?: boolean
  linkId?: string | null
  alreadyLinked?: boolean
  updatedAt?: string | null
}

type MergeMutationResponse = {
  ok?: boolean
  targetIncidentId?: string | null
  updatedAt?: string | null
}

type MutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type MergeLinkHeaderActionsProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  hidden?: boolean
  onChanged: () => void | Promise<void>
}

type IncidentLinksPanelProps = {
  incidentId: string
  updatedAt?: string | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

const linkKindOptions: readonly LinkKind[] = ['related', 'duplicate']

function normalizeIncidentOption(raw: IncidentOptionRecord, t: ReturnType<typeof useT>): IncidentOption | null {
  if (!raw.id) return null
  return {
    id: raw.id,
    number: raw.number?.trim() || t('incidents.incident.list.unnumbered'),
    title: raw.title?.trim() || t('incidents.incident.detail.untitled'),
    status: raw.status ?? null,
  }
}

function linkKindLabel(t: ReturnType<typeof useT>, kind: string): string {
  if (kind === 'related') return t('incidents.links.kind.related', 'Related')
  if (kind === 'duplicate') return t('incidents.links.kind.duplicate', 'Duplicate')
  return kind
}

function directionLabel(t: ReturnType<typeof useT>, direction: 'outgoing' | 'incoming'): string {
  return direction === 'incoming'
    ? t('incidents.links.direction.incoming', 'Linked from')
    : t('incidents.links.direction.outgoing', 'Linked to')
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function errorMessage(result: LinksResponse | null, fallback: string): string {
  return typeof result?.error === 'string' && result.error.trim().length > 0 ? result.error : fallback
}

function isLinkKind(value: string): value is LinkKind {
  return value === 'related' || value === 'duplicate'
}

function buildIncidentHref(id: string): string {
  return `/backend/incidents/${encodeURIComponent(id)}`
}

type IncidentPickerProps = {
  currentIncidentId: string
  selected: IncidentOption | null
  excludeClosed?: boolean
  onSelect: (incident: IncidentOption) => void
}

function IncidentPicker({ currentIncidentId, selected, excludeClosed = false, onSelect }: IncidentPickerProps) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [options, setOptions] = React.useState<IncidentOption[]>([])
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    let active = true
    const loadOptions = async () => {
      setIsLoading(true)
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      if (search.trim()) params.set('search', search.trim())
      const result = await apiCall<IncidentOptionsResponse>(`/api/incidents?${params.toString()}`)
      if (!active) return
      const normalized = Array.isArray(result.result?.items)
        ? result.result.items
          .map((item) => normalizeIncidentOption(item, t))
          .filter((item): item is IncidentOption => Boolean(item))
          .filter((item) => item.id !== currentIncidentId)
          .filter((item) => !excludeClosed || item.status !== 'closed')
        : []
      setOptions(normalized)
      setIsLoading(false)
    }
    loadOptions().catch(() => {
      if (!active) return
      setOptions([])
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [currentIncidentId, excludeClosed, search, t])

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`incident-picker-${excludeClosed ? 'merge' : 'link'}`}>
          {t('incidents.links.picker.searchLabel', 'Search incidents')}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id={`incident-picker-${excludeClosed ? 'merge' : 'link'}`}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className="pl-9"
            placeholder={t('incidents.links.picker.searchPlaceholder', 'Search by number or title')}
          />
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border bg-background p-2">
        {isLoading ? (
          <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
            <Spinner size="sm" />
            <span>{t('incidents.links.picker.loading', 'Loading incidents')}</span>
          </div>
        ) : options.length > 0 ? (
          options.map((option) => {
            const isSelected = selected?.id === option.id
            return (
              <Button
                key={option.id}
                type="button"
                variant={isSelected ? 'secondary' : 'ghost'}
                className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
                onClick={() => onSelect(option)}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{option.number}</span>
                  <span className="block truncate text-xs text-muted-foreground">{option.title}</span>
                </span>
              </Button>
            )
          })
        ) : (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {t('incidents.links.picker.empty', 'No incidents found.')}
          </p>
        )}
      </div>
    </div>
  )
}

export function MergeLinkHeaderActions({
  incidentId,
  updatedAt,
  canManage,
  hidden = false,
  onChanged,
}: MergeLinkHeaderActionsProps) {
  const t = useT()
  const router = useRouter()
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false)
  const [selectedLinkIncident, setSelectedLinkIncident] = React.useState<IncidentOption | null>(null)
  const [selectedMergeIncident, setSelectedMergeIncident] = React.useState<IncidentOption | null>(null)
  const [linkKind, setLinkKind] = React.useState<LinkKind>('related')
  const [pendingAction, setPendingAction] = React.useState<'link' | 'merge' | null>(null)
  const contextId = React.useMemo(() => `incident-link-merge:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<MutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const refreshAfterConflict = React.useCallback(() => {
    void onChanged()
  }, [onChanged])

  const handleError = React.useCallback((err: unknown, fallback: string) => {
    if (!surfaceRecordConflict(err, t, { onRefresh: refreshAfterConflict })) {
      flash(fallback, 'error')
    }
  }, [refreshAfterConflict, t])

  const handleLink = React.useCallback(async () => {
    if (!selectedLinkIncident || pendingAction) return
    setPendingAction('link')
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<LinkMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/links`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify({
              linkedIncidentId: selectedLinkIncident.id,
              kind: linkKind,
            }),
          },
          { errorMessage: t('incidents.links.error.create', 'Failed to link the incident.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, linkedIncidentId: selectedLinkIncident.id, kind: linkKind },
      })
      const freshUpdatedAt = call.result?.updatedAt
      if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
        setCurrentUpdatedAt(freshUpdatedAt)
      }
      flash(
        call.result?.alreadyLinked
          ? t('incidents.links.success.alreadyLinked', 'Incident link already exists.')
          : t('incidents.links.success.create', 'Incident linked.'),
        'success',
      )
      setLinkDialogOpen(false)
      setSelectedLinkIncident(null)
      await onChanged()
    } catch (err) {
      handleError(err, t('incidents.links.error.create', 'Failed to link the incident.'))
    } finally {
      setPendingAction(null)
    }
  }, [
    currentUpdatedAt,
    handleError,
    incidentId,
    linkKind,
    mutationContext,
    onChanged,
    pendingAction,
    runMutation,
    selectedLinkIncident,
    t,
  ])

  const handleMerge = React.useCallback(async () => {
    if (!selectedMergeIncident || pendingAction) return
    setPendingAction('merge')
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<MergeMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/merge`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: JSON.stringify({ targetIncidentId: selectedMergeIncident.id }),
          },
          { errorMessage: t('incidents.merge.error', 'Failed to merge the incident.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, targetIncidentId: selectedMergeIncident.id },
      })
      const targetIncidentId = call.result?.targetIncidentId ?? selectedMergeIncident.id
      const freshUpdatedAt = call.result?.updatedAt
      if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
        setCurrentUpdatedAt(freshUpdatedAt)
      }
      flash(t('incidents.merge.success', 'Incident merged.'), 'success')
      setMergeDialogOpen(false)
      router.push(buildIncidentHref(targetIncidentId))
    } catch (err) {
      handleError(err, t('incidents.merge.error', 'Failed to merge the incident.'))
    } finally {
      setPendingAction(null)
    }
  }, [
    currentUpdatedAt,
    handleError,
    incidentId,
    mutationContext,
    pendingAction,
    router,
    runMutation,
    selectedMergeIncident,
    t,
  ])

  const handleLinkDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleLink()
    }
    if (event.key === 'Escape' && pendingAction !== 'link') {
      setLinkDialogOpen(false)
    }
  }, [handleLink, pendingAction])

  const handleMergeDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleMerge()
    }
    if (event.key === 'Escape' && pendingAction !== 'merge') {
      setMergeDialogOpen(false)
    }
  }, [handleMerge, pendingAction])

  if (!canManage || hidden) return null

  return (
    <>
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={pendingAction !== null}
            className="whitespace-nowrap"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
            {t('incidents.incident.detail.actions.more', 'More')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start whitespace-nowrap"
            disabled={pendingAction !== null}
            onClick={() => {
              setMoreOpen(false)
              setSelectedLinkIncident(null)
              setLinkKind('related')
              setLinkDialogOpen(true)
            }}
          >
            <Link2 className="size-4" aria-hidden="true" />
            {t('incidents.links.actions.link', 'Link incident')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start whitespace-nowrap text-status-error-text"
            disabled={pendingAction !== null}
            onClick={() => {
              setMoreOpen(false)
              setSelectedMergeIncident(null)
              setMergeDialogOpen(true)
            }}
          >
            <GitMerge className="size-4" aria-hidden="true" />
            {t('incidents.merge.actions.open', 'Merge into another...')}
          </Button>
        </PopoverContent>
      </Popover>

      <Dialog open={linkDialogOpen} onOpenChange={(open) => {
        if (!open && pendingAction !== 'link') setLinkDialogOpen(false)
      }}>
        <DialogContent className="sm:max-w-xl" onKeyDown={handleLinkDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('incidents.links.dialog.title', 'Link incident')}</DialogTitle>
            <DialogDescription>
              {t('incidents.links.dialog.description', 'Create a related or duplicate link to another incident.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <IncidentPicker
              currentIncidentId={incidentId}
              selected={selectedLinkIncident}
              onSelect={setSelectedLinkIncident}
            />
            <div className="space-y-2">
              <Label htmlFor="incident-link-kind">{t('incidents.links.fields.kind', 'Kind')}</Label>
              <Select
                value={linkKind}
                onValueChange={(value) => {
                  if (isLinkKind(value)) setLinkKind(value)
                }}
                disabled={pendingAction === 'link'}
              >
                <SelectTrigger id="incident-link-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {linkKindOptions.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {linkKindLabel(t, kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
              disabled={pendingAction === 'link'}
            >
              {t('incidents.common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleLink()}
              disabled={!selectedLinkIncident || pendingAction === 'link'}
            >
              <Link2 className="size-4" aria-hidden="true" />
              {t('incidents.links.actions.submit', 'Link incident')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeDialogOpen} onOpenChange={(open) => {
        if (!open && pendingAction !== 'merge') setMergeDialogOpen(false)
      }}>
        <DialogContent className="sm:max-w-xl" onKeyDown={handleMergeDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('incidents.merge.dialog.title', 'Merge incident')}</DialogTitle>
            <DialogDescription>
              {t('incidents.merge.dialog.description', 'Choose the surviving incident.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <IncidentPicker
              currentIncidentId={incidentId}
              selected={selectedMergeIncident}
              excludeClosed
              onSelect={setSelectedMergeIncident}
            />
            <Alert status="warning" style="lighter" size="default">
              <AlertTitle>{t('incidents.merge.warning.title', 'Merge is permanent')}</AlertTitle>
              <AlertDescription>
                {t('incidents.merge.warning.description', 'This incident will be closed and become read-only, its impacts and action items move to the target, its number is retained.')}
              </AlertDescription>
            </Alert>
            {selectedMergeIncident ? (
              <div className="rounded-md border border-border bg-background p-3 text-sm">
                <p className="text-muted-foreground">{t('incidents.merge.target.label', 'Target incident')}</p>
                <p className="mt-1 font-medium text-foreground">
                  {selectedMergeIncident.number} — {selectedMergeIncident.title}
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMergeDialogOpen(false)}
              disabled={pendingAction === 'merge'}
            >
              {t('incidents.common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleMerge()}
              disabled={!selectedMergeIncident || pendingAction === 'merge'}
            >
              <GitMerge className="size-4" aria-hidden="true" />
              {t('incidents.merge.actions.confirm', 'Merge into target')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function IncidentLinksPanel({ incidentId, updatedAt, canManage, onChanged }: IncidentLinksPanelProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [items, setItems] = React.useState<LinkItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [currentUpdatedAt, setCurrentUpdatedAt] = React.useState<string | null>(updatedAt ?? null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const contextId = React.useMemo(() => `incident-links:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<MutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  React.useEffect(() => {
    setCurrentUpdatedAt(updatedAt ?? null)
  }, [updatedAt])

  const loadLinks = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const result = await apiCall<LinksResponse>(`/api/incidents/${encodeURIComponent(incidentId)}/links`)
    if (!result.ok) {
      throw new Error(errorMessage(result.result, t('incidents.links.error.load', 'Failed to load linked incidents.')))
    }
    setItems(Array.isArray(result.result?.items) ? result.result.items : [])
    setIsLoading(false)
  }, [incidentId, t])

  React.useEffect(() => {
    let active = true
    loadLinks().catch((err) => {
      if (!active) return
      setError(err instanceof Error ? err.message : t('incidents.links.error.load', 'Failed to load linked incidents.'))
      setIsLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadLinks, t])

  useAppEvent('incidents.incident.linked', (event) => {
    const sourceIncidentId = readPayloadString(event.payload, 'incidentId')
    const linkedIncidentId = readPayloadString(event.payload, 'linkedIncidentId')
    if (sourceIncidentId === incidentId || linkedIncidentId === incidentId) void loadLinks()
  }, [incidentId, loadLinks])

  useAppEvent('incidents.incident.merged', (event) => {
    const sourceIncidentId = readPayloadString(event.payload, 'sourceIncidentId')
    const targetIncidentId = readPayloadString(event.payload, 'targetIncidentId')
    if (sourceIncidentId === incidentId || targetIncidentId === incidentId) void loadLinks()
  }, [incidentId, loadLinks])

  useAppEvent('incidents.timeline_entry.added', (event) => {
    const eventIncidentId = readPayloadString(event.payload, 'incidentId')
    const kind = readPayloadString(event.payload, 'kind')
    if ((!eventIncidentId || eventIncidentId === incidentId) && (kind === 'linked' || kind === 'unlinked')) {
      void loadLinks()
    }
  }, [incidentId, loadLinks])

  const refreshAfterConflict = React.useCallback(() => {
    void loadLinks()
    void onChanged()
  }, [loadLinks, onChanged])

  const handleRemove = React.useCallback(async (item: LinkItem) => {
    if (!canManage || pendingId) return
    const approved = await confirm({
      title: t('incidents.links.delete.title', 'Remove incident link?'),
      description: t('incidents.links.delete.description', 'The incidents will no longer be linked.'),
      confirmText: t('incidents.links.actions.remove', 'Remove'),
      cancelText: t('incidents.common.cancel'),
      variant: 'destructive',
    })
    if (!approved) return

    setPendingId(item.id)
    try {
      const call = await runMutation({
        operation: async () => apiCallOrThrow<LinkMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/links/${encodeURIComponent(item.id)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(currentUpdatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.links.error.delete', 'Failed to remove the incident link.') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, linkId: item.id, operation: 'removeIncidentLink' },
      })
      const freshUpdatedAt = call.result?.updatedAt
      if (typeof freshUpdatedAt === 'string' && freshUpdatedAt.length > 0) {
        setCurrentUpdatedAt(freshUpdatedAt)
      }
      flash(t('incidents.links.success.delete', 'Incident link removed.'), 'success')
      await loadLinks()
      await onChanged()
    } catch (err) {
      if (!surfaceRecordConflict(err, t, { onRefresh: refreshAfterConflict })) {
        flash(t('incidents.links.error.delete', 'Failed to remove the incident link.'), 'error')
      }
    } finally {
      setPendingId(null)
    }
  }, [
    canManage,
    confirm,
    currentUpdatedAt,
    incidentId,
    loadLinks,
    mutationContext,
    onChanged,
    pendingId,
    refreshAfterConflict,
    runMutation,
    t,
  ])

  if (isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.links.title', 'Linked incidents')} />
        <div className="mt-4 flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('incidents.links.loading', 'Loading linked incidents')}</span>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHeader title={t('incidents.links.title', 'Linked incidents')} />
        <div className="mt-4">
          <ErrorMessage label={error} />
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHeader title={t('incidents.links.title', 'Linked incidents')} count={items.length} />
      <div className="mt-4">
        {items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge variant={item.kind === 'duplicate' ? 'warning' : 'info'}>
                        {linkKindLabel(t, item.kind)}
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">{directionLabel(t, item.direction)}</span>
                    </div>
                    <Link
                      href={buildIncidentHref(item.linkedIncident.id)}
                      className="mt-2 block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {item.linkedIncident.number} — {item.linkedIncident.title}
                    </Link>
                  </div>
                  {canManage ? (
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('incidents.links.actions.removeAria', 'Remove incident link')}
                      disabled={pendingId !== null}
                      onClick={() => void handleRemove(item)}
                    >
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            variant="subtle"
            icon={<Link2 className="size-6" aria-hidden="true" />}
            title={t('incidents.links.empty.title', 'No linked incidents')}
            description={t('incidents.links.empty.description', 'Related and duplicate incidents appear here.')}
          />
        )}
      </div>
      {ConfirmDialogElement}
    </section>
  )
}
