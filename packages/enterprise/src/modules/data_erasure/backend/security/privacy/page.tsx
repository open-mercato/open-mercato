'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import {
  apiCall,
  apiCallOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import type {
  PrivacyDataClass,
  PrivacyLegalHold,
  PrivacyOperation,
  PrivacyPolicy,
  PrivacySubjectAction,
  ResolvedSubjectRow,
  SubjectRequestResponse,
  SubjectResolutionResponse,
} from './_types'

type PolicyDraft = {
  dataClassId: string
  retentionDays: string
  action: 'delete' | 'anonymize'
  batchSize: string
  isActive: boolean
}

type HoldDraft = {
  dataClassId: string
  subjectKind: string
  subjectId: string
  reason: string
  expiresAt: string
}

type SubjectIdentifierKind = 'email' | 'phone' | 'name'

const EMPTY_POLICY: PolicyDraft = {
  dataClassId: '',
  retentionDays: '365',
  action: 'delete',
  batchSize: '100',
  isActive: true,
}

const EMPTY_HOLD: HoldDraft = {
  dataClassId: '',
  subjectKind: '',
  subjectId: '',
  reason: '',
  expiresAt: '',
}

const NO_DATA_CLASS = '__none__'

const OPERATION_STATUS_VARIANT: Record<PrivacyOperation['status'], StatusBadgeVariant> = {
  running: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'error',
  blocked: 'warning',
}

export default function PrivacyManagementPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data-erasure-management',
  })
  const [dataClasses, setDataClasses] = React.useState<PrivacyDataClass[]>([])
  const [policies, setPolicies] = React.useState<PrivacyPolicy[]>([])
  const [holds, setHolds] = React.useState<PrivacyLegalHold[]>([])
  const [operations, setOperations] = React.useState<PrivacyOperation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [policyDraft, setPolicyDraft] = React.useState<PolicyDraft>(EMPTY_POLICY)
  const [editingPolicy, setEditingPolicy] = React.useState<PrivacyPolicy | null>(null)
  const [holdDraft, setHoldDraft] = React.useState<HoldDraft>(EMPTY_HOLD)
  const [subjectIdentifierKind, setSubjectIdentifierKind] = React.useState<SubjectIdentifierKind>('email')
  const [subjectIdentifierValue, setSubjectIdentifierValue] = React.useState('')
  const [resolvedSubjects, setResolvedSubjects] = React.useState<ResolvedSubjectRow[]>([])
  const [subjectOutput, setSubjectOutput] = React.useState<unknown>(null)

  const mutate = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { retryLastMutation },
      })
    },
    [retryLastMutation, runMutation],
  )

  const loadAll = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const [classesResult, policiesResult, holdsResult, operationsResult] = await Promise.all([
      apiCall<{ items: PrivacyDataClass[] }>('/api/data_erasure/data-classes'),
      apiCall<{ items: PrivacyPolicy[] }>('/api/data_erasure/policies'),
      apiCall<{ items: PrivacyLegalHold[] }>('/api/data_erasure/legal-holds'),
      apiCall<{ items: PrivacyOperation[] }>('/api/data_erasure/operations?page=1&pageSize=100'),
    ])
    if (
      !classesResult.ok || !classesResult.result
      || !policiesResult.ok || !policiesResult.result
      || !holdsResult.ok || !holdsResult.result
      || !operationsResult.ok || !operationsResult.result
    ) {
      setLoadError(t('data_erasure.errors.load'))
      setLoading(false)
      return
    }
    setDataClasses(classesResult.result.items ?? [])
    setPolicies(policiesResult.result.items ?? [])
    setHolds(holdsResult.result.items ?? [])
    setOperations(operationsResult.result.items ?? [])
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void loadAll()
  }, [loadAll])

  const retentionClasses = React.useMemo(
    () => dataClasses.filter((item) => item.retention),
    [dataClasses],
  )

  const classById = React.useMemo(
    () => new Map(dataClasses.map((item) => [item.id, item])),
    [dataClasses],
  )

  React.useEffect(() => {
    if (policyDraft.dataClassId || retentionClasses.length === 0) return
    const first = retentionClasses[0]
    if (!first?.retention) return
    setPolicyDraft({
      dataClassId: first.id,
      retentionDays: String(first.retention.defaultDays),
      action: first.retention.actions[0] ?? 'delete',
      batchSize: '100',
      isActive: true,
    })
  }, [policyDraft.dataClassId, retentionClasses])

  React.useEffect(() => {
    if (holdDraft.dataClassId || dataClasses.length === 0) return
    setHoldDraft((current) => ({ ...current, dataClassId: dataClasses[0]?.id ?? '' }))
  }, [dataClasses, holdDraft.dataClassId])

  const resetPolicyForm = React.useCallback(() => {
    const first = retentionClasses[0]
    setEditingPolicy(null)
    setPolicyDraft(first?.retention ? {
      dataClassId: first.id,
      retentionDays: String(first.retention.defaultDays),
      action: first.retention.actions[0] ?? 'delete',
      batchSize: '100',
      isActive: true,
    } : EMPTY_POLICY)
  }, [retentionClasses])

  const selectPolicyClass = React.useCallback((dataClassId: string) => {
    const definition = classById.get(dataClassId)
    setPolicyDraft((current) => ({
      ...current,
      dataClassId,
      retentionDays: String(definition?.retention?.defaultDays ?? (Number(current.retentionDays) || 365)),
      action: definition?.retention?.actions[0] ?? 'delete',
    }))
  }, [classById])

  const savePolicy = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    const retentionDays = Number.parseInt(policyDraft.retentionDays, 10)
    const batchSize = Number.parseInt(policyDraft.batchSize, 10)
    if (!policyDraft.dataClassId || !Number.isInteger(retentionDays) || !Number.isInteger(batchSize)) {
      flash(t('data_erasure.errors.form'), 'error')
      return
    }
    const payload = {
      dataClassId: policyDraft.dataClassId,
      retentionDays,
      action: policyDraft.action,
      batchSize,
      isActive: policyDraft.isActive,
    }
    setSaving(true)
    try {
      if (editingPolicy) {
        await mutate(
          () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(editingPolicy.updatedAt),
            () => apiCallOrThrow(`/api/data_erasure/policies/${encodeURIComponent(editingPolicy.id)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                retentionDays,
                action: policyDraft.action,
                batchSize,
                isActive: policyDraft.isActive,
              }),
            }),
          ),
          payload,
        )
        flash(t('data_erasure.policy.updated'), 'success')
      } else {
        await mutate(
          () => apiCallOrThrow('/api/data_erasure/policies', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          payload,
        )
        flash(t('data_erasure.policy.created'), 'success')
      }
      resetPolicyForm()
      await loadAll()
    } catch {
      flash(t('data_erasure.errors.save'), 'error')
    } finally {
      setSaving(false)
    }
  }, [editingPolicy, loadAll, mutate, policyDraft, resetPolicyForm, t])

  const editPolicy = React.useCallback((policy: PrivacyPolicy) => {
    setEditingPolicy(policy)
    setPolicyDraft({
      dataClassId: policy.dataClassId,
      retentionDays: String(policy.retentionDays),
      action: policy.action,
      batchSize: String(policy.batchSize),
      isActive: policy.isActive,
    })
  }, [])

  const runPolicy = React.useCallback(async (policy: PrivacyPolicy, dryRun: boolean) => {
    if (!dryRun) {
      const accepted = await confirm({
        title: t('data_erasure.policy.run.confirmTitle'),
        text: t('data_erasure.policy.run.confirmText'),
        variant: 'destructive',
        confirmText: t('data_erasure.policy.run.apply'),
        cancelText: t('data_erasure.actions.cancel'),
      })
      if (!accepted) return
    }
    const payload = { policyId: policy.id, dryRun, maxBatches: 20 }
    setSaving(true)
    try {
      await mutate(
        () => apiCallOrThrow('/api/data_erasure/retention/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        payload,
      )
      flash(t(dryRun ? 'data_erasure.policy.run.previewDone' : 'data_erasure.policy.run.applyDone'), 'success')
      await loadAll()
    } catch {
      flash(t('data_erasure.errors.operation'), 'error')
    } finally {
      setSaving(false)
    }
  }, [confirm, loadAll, mutate, t])

  const saveHold = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    const subjectKind = holdDraft.subjectKind.trim()
    const subjectId = holdDraft.subjectId.trim()
    const payload = {
      ...(holdDraft.dataClassId ? { dataClassId: holdDraft.dataClassId } : {}),
      ...(subjectKind && subjectId ? { subject: { kind: subjectKind, id: subjectId } } : {}),
      reason: holdDraft.reason.trim(),
      ...(holdDraft.expiresAt ? { expiresAt: new Date(holdDraft.expiresAt).toISOString() } : {}),
    }
    if (!payload.reason || (!payload.dataClassId && !('subject' in payload))) {
      flash(t('data_erasure.errors.form'), 'error')
      return
    }
    setSaving(true)
    try {
      await mutate(
        () => apiCallOrThrow('/api/data_erasure/legal-holds', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        payload,
      )
      flash(t('data_erasure.hold.created'), 'success')
      setHoldDraft({ ...EMPTY_HOLD, dataClassId: dataClasses[0]?.id ?? '' })
      await loadAll()
    } catch {
      flash(t('data_erasure.errors.save'), 'error')
    } finally {
      setSaving(false)
    }
  }, [dataClasses, holdDraft, loadAll, mutate, t])

  const releaseHold = React.useCallback(async (hold: PrivacyLegalHold) => {
    const accepted = await confirm({
      title: t('data_erasure.hold.release.confirmTitle'),
      text: t('data_erasure.hold.release.confirmText'),
      confirmText: t('data_erasure.hold.release.action'),
      cancelText: t('data_erasure.actions.cancel'),
    })
    if (!accepted) return
    setSaving(true)
    try {
      await mutate(
        () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(hold.updatedAt),
          () => apiCallOrThrow(`/api/data_erasure/legal-holds/${encodeURIComponent(hold.id)}/release`, {
            method: 'POST',
          }),
        ),
        { id: hold.id },
      )
      flash(t('data_erasure.hold.released'), 'success')
      await loadAll()
    } catch {
      flash(t('data_erasure.errors.operation'), 'error')
    } finally {
      setSaving(false)
    }
  }, [confirm, loadAll, mutate, t])

  const resolveSubject = React.useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    const identifierValue = subjectIdentifierValue.trim()
    if (!identifierValue) {
      flash(t('data_erasure.errors.form'), 'error')
      return
    }
    setSaving(true)
    setSubjectOutput(null)
    try {
      const response = await mutate(
        () => apiCallOrThrow<SubjectResolutionResponse>('/api/data_erasure/subjects/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identifier: { kind: subjectIdentifierKind, value: identifierValue } }),
        }),
        { identifierKind: subjectIdentifierKind },
      )
      const rows = Object.entries(response.result?.subjects ?? {}).flatMap(([dataClassId, subjects]) => (
        subjects.map((subject) => ({
          id: `${dataClassId}:${subject.kind}:${subject.id}`,
          dataClassId,
          kind: subject.kind,
          subjectId: subject.id,
        }))
      ))
      setResolvedSubjects(rows)
      flash(t('data_erasure.subject.resolved'), 'success')
      await loadAll()
    } catch {
      setResolvedSubjects([])
      flash(t('data_erasure.errors.operation'), 'error')
    } finally {
      setSaving(false)
    }
  }, [loadAll, mutate, subjectIdentifierKind, subjectIdentifierValue, t])

  const runSubjectAction = React.useCallback(async (
    subject: ResolvedSubjectRow,
    action: PrivacySubjectAction,
  ) => {
    if (action === 'erase' || action === 'anonymize') {
      const accepted = await confirm({
        title: t(`data_erasure.subject.${action}.confirmTitle`),
        text: t(`data_erasure.subject.${action}.confirmText`),
        variant: 'destructive',
        confirmText: t(`data_erasure.subject.${action}.action`),
        cancelText: t('data_erasure.actions.cancel'),
      })
      if (!accepted) return
    }
    const payload = {
      action,
      subject: { kind: subject.kind, id: subject.subjectId },
      dataClassIds: [subject.dataClassId],
      dryRun: action === 'discover' || action === 'export',
    }
    setSaving(true)
    try {
      const response = await mutate(
        () => apiCallOrThrow<SubjectRequestResponse>('/api/data_erasure/subjects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        payload,
      )
      setSubjectOutput(response.result ?? null)
      flash(t('data_erasure.subject.actionDone'), 'success')
      await loadAll()
    } catch {
      flash(t('data_erasure.errors.operation'), 'error')
    } finally {
      setSaving(false)
    }
  }, [confirm, loadAll, mutate, t])

  const policyColumns = React.useMemo<ColumnDef<PrivacyPolicy>[]>(() => [
    {
      accessorKey: 'dataClassId',
      header: t('data_erasure.policy.dataClass'),
      cell: ({ row }) => classById.get(row.original.dataClassId)?.title ?? row.original.dataClassId,
    },
    {
      accessorKey: 'retentionDays',
      header: t('data_erasure.policy.retentionDays'),
    },
    {
      accessorKey: 'action',
      header: t('data_erasure.policy.action'),
      cell: ({ row }) => t(`data_erasure.action.${row.original.action}`),
    },
    {
      accessorKey: 'batchSize',
      header: t('data_erasure.policy.batchSize'),
    },
    {
      accessorKey: 'isActive',
      header: t('data_erasure.policy.status'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {t(row.original.isActive ? 'data_erasure.status.active' : 'data_erasure.status.inactive')}
        </StatusBadge>
      ),
    },
  ], [classById, t])

  const holdColumns = React.useMemo<ColumnDef<PrivacyLegalHold>[]>(() => [
    {
      accessorKey: 'dataClassId',
      header: t('data_erasure.hold.dataClass'),
      cell: ({ row }) => row.original.dataClassId
        ? classById.get(row.original.dataClassId)?.title ?? row.original.dataClassId
        : t('data_erasure.common.allClasses'),
    },
    {
      id: 'subject',
      header: t('data_erasure.hold.subject'),
      cell: ({ row }) => row.original.subjectKind && row.original.subjectId
        ? `${row.original.subjectKind}:${row.original.subjectId}`
        : t('data_erasure.common.wholeClass'),
    },
    {
      accessorKey: 'reason',
      header: t('data_erasure.hold.reason'),
      meta: { truncate: true, maxWidth: 320 },
    },
    {
      accessorKey: 'expiresAt',
      header: t('data_erasure.hold.expiresAt'),
      cell: ({ row }) => formatDate(row.original.expiresAt, t('data_erasure.common.noExpiry')),
    },
    {
      accessorKey: 'releasedAt',
      header: t('data_erasure.hold.status'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.releasedAt ? 'neutral' : 'warning'} dot>
          {t(row.original.releasedAt ? 'data_erasure.status.released' : 'data_erasure.status.held')}
        </StatusBadge>
      ),
    },
  ], [classById, t])

  const operationColumns = React.useMemo<ColumnDef<PrivacyOperation>[]>(() => [
    {
      accessorKey: 'type',
      header: t('data_erasure.operation.type'),
      cell: ({ row }) => t(`data_erasure.operation.type.${row.original.type}`),
    },
    {
      accessorKey: 'status',
      header: t('data_erasure.operation.status'),
      cell: ({ row }) => (
        <StatusBadge variant={OPERATION_STATUS_VARIANT[row.original.status]} dot>
          {t(`data_erasure.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'dataClassId',
      header: t('data_erasure.operation.dataClass'),
      cell: ({ row }) => row.original.dataClassId
        ? classById.get(row.original.dataClassId)?.title ?? row.original.dataClassId
        : t('data_erasure.common.notApplicable'),
    },
    {
      id: 'subject',
      header: t('data_erasure.operation.subject'),
      cell: ({ row }) => row.original.subjectKind && row.original.subjectId
        ? `${row.original.subjectKind}:${row.original.subjectId}`
        : t('data_erasure.common.notApplicable'),
    },
    {
      accessorKey: 'dryRun',
      header: t('data_erasure.operation.mode'),
      cell: ({ row }) => t(row.original.dryRun ? 'data_erasure.mode.preview' : 'data_erasure.mode.apply'),
    },
    {
      accessorKey: 'createdAt',
      header: t('data_erasure.operation.createdAt'),
      cell: ({ row }) => formatDate(row.original.createdAt, ''),
    },
  ], [classById, t])

  const subjectColumns = React.useMemo<ColumnDef<ResolvedSubjectRow>[]>(() => [
    {
      accessorKey: 'dataClassId',
      header: t('data_erasure.subject.dataClass'),
      cell: ({ row }) => classById.get(row.original.dataClassId)?.title ?? row.original.dataClassId,
    },
    {
      accessorKey: 'kind',
      header: t('data_erasure.subject.kind'),
    },
    {
      accessorKey: 'subjectId',
      header: t('data_erasure.subject.id'),
      meta: { truncate: true, maxWidth: 320 },
    },
  ], [classById, t])

  if (loading && dataClasses.length === 0) {
    return <LoadingMessage label={t('data_erasure.loading')} />
  }

  if (loadError && dataClasses.length === 0) {
    return (
      <ErrorMessage
        label={loadError}
        action={(
          <Button type="button" variant="outline" onClick={() => void loadAll()}>
            {t('data_erasure.actions.retry')}
          </Button>
        )}
      />
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('data_erasure.page.title')}
        description={t('data_erasure.page.description')}
        actions={(
          <Button type="button" variant="outline" onClick={() => void loadAll()} disabled={loading}>
            {t('data_erasure.actions.refresh')}
          </Button>
        )}
      />
      <PageBody>
        <Tabs defaultValue="policies" className="space-y-5">
          <TabsList className="w-full overflow-x-auto">
            <TabsTrigger value="policies">{t('data_erasure.tabs.policies')}</TabsTrigger>
            <TabsTrigger value="holds">{t('data_erasure.tabs.holds')}</TabsTrigger>
            <TabsTrigger value="subjects">{t('data_erasure.tabs.subjects')}</TabsTrigger>
            <TabsTrigger value="operations">{t('data_erasure.tabs.operations')}</TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="mt-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{t(editingPolicy ? 'data_erasure.policy.editTitle' : 'data_erasure.policy.createTitle')}</CardTitle>
                <CardDescription>{t('data_erasure.policy.formDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 lg:grid-cols-5" onSubmit={savePolicy}>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="privacy-policy-class">{t('data_erasure.policy.dataClass')}</Label>
                    <Select value={policyDraft.dataClassId} onValueChange={selectPolicyClass} disabled={Boolean(editingPolicy)}>
                      <SelectTrigger id="privacy-policy-class"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {retentionClasses.map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-policy-days">{t('data_erasure.policy.retentionDays')}</Label>
                    <Input
                      id="privacy-policy-days"
                      type="number"
                      min={1}
                      max={36500}
                      value={policyDraft.retentionDays}
                      onChange={(event) => setPolicyDraft((current) => ({ ...current, retentionDays: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-policy-action">{t('data_erasure.policy.action')}</Label>
                    <Select
                      value={policyDraft.action}
                      onValueChange={(value) => setPolicyDraft((current) => ({
                        ...current,
                        action: value === 'anonymize' ? 'anonymize' : 'delete',
                      }))}
                    >
                      <SelectTrigger id="privacy-policy-action"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(classById.get(policyDraft.dataClassId)?.retention?.actions ?? ['delete']).map((action) => (
                          <SelectItem key={action} value={action}>{t(`data_erasure.action.${action}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-policy-batch">{t('data_erasure.policy.batchSize')}</Label>
                    <Input
                      id="privacy-policy-batch"
                      type="number"
                      min={1}
                      max={1000}
                      value={policyDraft.batchSize}
                      onChange={(event) => setPolicyDraft((current) => ({ ...current, batchSize: event.target.value }))}
                    />
                  </div>
                  <div className="flex items-center gap-3 lg:col-span-3">
                    <Switch
                      id="privacy-policy-active"
                      checked={policyDraft.isActive}
                      onCheckedChange={(checked) => setPolicyDraft((current) => ({ ...current, isActive: checked }))}
                    />
                    <Label htmlFor="privacy-policy-active">{t('data_erasure.policy.active')}</Label>
                  </div>
                  <div className="flex justify-end gap-2 lg:col-span-2">
                    {editingPolicy ? (
                      <Button type="button" variant="outline" onClick={resetPolicyForm} disabled={saving}>
                        {t('data_erasure.actions.cancel')}
                      </Button>
                    ) : null}
                    <Button type="submit" disabled={saving || !policyDraft.dataClassId}>
                      {t(editingPolicy ? 'data_erasure.actions.save' : 'data_erasure.actions.create')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <DataTable<PrivacyPolicy>
              extensionTableId="data_erasure.policies"
              title={t('data_erasure.policy.listTitle')}
              columns={policyColumns}
              data={policies}
              isLoading={loading}
              emptyState={t('data_erasure.policy.empty')}
              disableRowClick
              stickyActionsColumn
              rowActions={(policy) => (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => editPolicy(policy)} disabled={saving}>
                    {t('data_erasure.actions.edit')}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void runPolicy(policy, true)} disabled={saving || !policy.isActive}>
                    {t('data_erasure.policy.run.preview')}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => void runPolicy(policy, false)} disabled={saving || !policy.isActive}>
                    {t('data_erasure.policy.run.apply')}
                  </Button>
                </div>
              )}
            />
          </TabsContent>

          <TabsContent value="holds" className="mt-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{t('data_erasure.hold.createTitle')}</CardTitle>
                <CardDescription>{t('data_erasure.hold.formDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 lg:grid-cols-2" onSubmit={saveHold}>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-hold-class">{t('data_erasure.hold.dataClass')}</Label>
                    <Select
                      value={holdDraft.dataClassId || NO_DATA_CLASS}
                      onValueChange={(value) => setHoldDraft((current) => ({
                        ...current,
                        dataClassId: value === NO_DATA_CLASS ? '' : value,
                      }))}
                    >
                      <SelectTrigger id="privacy-hold-class"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_DATA_CLASS}>{t('data_erasure.common.allClasses')}</SelectItem>
                        {dataClasses.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-hold-expiry">{t('data_erasure.hold.expiresAt')}</Label>
                    <Input
                      id="privacy-hold-expiry"
                      type="datetime-local"
                      value={holdDraft.expiresAt}
                      onChange={(event) => setHoldDraft((current) => ({ ...current, expiresAt: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-hold-kind">{t('data_erasure.subject.kind')}</Label>
                    <Input
                      id="privacy-hold-kind"
                      value={holdDraft.subjectKind}
                      onChange={(event) => setHoldDraft((current) => ({ ...current, subjectKind: event.target.value }))}
                      placeholder={t('data_erasure.hold.kindPlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-hold-subject">{t('data_erasure.subject.id')}</Label>
                    <Input
                      id="privacy-hold-subject"
                      value={holdDraft.subjectId}
                      onChange={(event) => setHoldDraft((current) => ({ ...current, subjectId: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor="privacy-hold-reason">{t('data_erasure.hold.reason')}</Label>
                    <Textarea
                      id="privacy-hold-reason"
                      value={holdDraft.reason}
                      onChange={(event) => setHoldDraft((current) => ({ ...current, reason: event.target.value }))}
                    />
                  </div>
                  <div className="flex justify-end lg:col-span-2">
                    <Button type="submit" disabled={saving}>{t('data_erasure.actions.create')}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <DataTable<PrivacyLegalHold>
              extensionTableId="data_erasure.legal_holds"
              title={t('data_erasure.hold.listTitle')}
              columns={holdColumns}
              data={holds}
              isLoading={loading}
              emptyState={t('data_erasure.hold.empty')}
              disableRowClick
              stickyActionsColumn
              rowActions={(hold) => hold.releasedAt ? null : (
                <Button type="button" variant="outline" size="sm" onClick={() => void releaseHold(hold)} disabled={saving}>
                  {t('data_erasure.hold.release.action')}
                </Button>
              )}
            />
          </TabsContent>

          <TabsContent value="subjects" className="mt-0 space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>{t('data_erasure.subject.resolveTitle')}</CardTitle>
                <CardDescription>{t('data_erasure.subject.resolveDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-3 sm:flex-row" onSubmit={resolveSubject}>
                  <Select
                    value={subjectIdentifierKind}
                    onValueChange={(value) => {
                      setSubjectIdentifierKind(value as SubjectIdentifierKind)
                      setSubjectIdentifierValue('')
                    }}
                  >
                    <SelectTrigger className="sm:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">{t('data_erasure.subject.identifier.email')}</SelectItem>
                      <SelectItem value="phone">{t('data_erasure.subject.identifier.phone')}</SelectItem>
                      <SelectItem value="name">{t('data_erasure.subject.identifier.name')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {subjectIdentifierKind === 'email' ? (
                    <EmailInput
                      value={subjectIdentifierValue}
                      onChange={(event) => setSubjectIdentifierValue(event.target.value)}
                      placeholder={t('data_erasure.subject.emailPlaceholder')}
                    />
                  ) : subjectIdentifierKind === 'phone' ? (
                    <Input
                      type="tel"
                      value={subjectIdentifierValue}
                      onChange={(event) => setSubjectIdentifierValue(event.target.value)}
                      placeholder={t('data_erasure.subject.phonePlaceholder')}
                    />
                  ) : (
                    <Input
                      value={subjectIdentifierValue}
                      onChange={(event) => setSubjectIdentifierValue(event.target.value)}
                      placeholder={t('data_erasure.subject.namePlaceholder')}
                    />
                  )}
                  <Button type="submit" disabled={saving}>{t('data_erasure.subject.resolve')}</Button>
                </form>
              </CardContent>
            </Card>

            <DataTable<ResolvedSubjectRow>
              extensionTableId="data_erasure.subjects"
              title={t('data_erasure.subject.listTitle')}
              columns={subjectColumns}
              data={resolvedSubjects}
              emptyState={t('data_erasure.subject.empty')}
              disableRowClick
              stickyActionsColumn
              rowActions={(subject) => (
                <div className="flex items-center gap-2">
                  {(['discover', 'export', 'anonymize', 'erase'] as const).map((action) => (
                    <Button
                      key={action}
                      type="button"
                      variant={action === 'erase' ? 'destructive' : 'outline'}
                      size="sm"
                      onClick={() => void runSubjectAction(subject, action)}
                      disabled={saving || !classById.get(subject.dataClassId)?.subjectActions.includes(action)}
                    >
                      {t(`data_erasure.subject.action.${action}`)}
                    </Button>
                  ))}
                </div>
              )}
            />

            {subjectOutput !== null ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('data_erasure.subject.resultTitle')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs">
                    {JSON.stringify(subjectOutput, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="operations" className="mt-0">
            <DataTable<PrivacyOperation>
              extensionTableId="data_erasure.operations"
              title={t('data_erasure.operation.listTitle')}
              columns={operationColumns}
              data={operations}
              isLoading={loading}
              emptyState={t('data_erasure.operation.empty')}
              disableRowClick
            />
          </TabsContent>
        </Tabs>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}
