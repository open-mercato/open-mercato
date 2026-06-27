"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { z } from 'zod'
import { Plus, Binary, Sparkles, OctagonX, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const ENTITY_ID = 'agent_orchestrator:agent_eval_assertion'

type AssertionRow = {
  id: string
  key: string
  title: string
  description: string | null
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  rubric: string
  enabled: boolean
  updatedAt: string | null
}

type FormValues = {
  id?: string
  key: string
  title: string
  description?: string
  appliesTo: string
  type: 'deterministic' | 'llm_judge'
  severity: 'gate' | 'warn'
  rubric?: string
  enabled: boolean
  updatedAt?: string | null
}

const severityVariant: StatusMap<'gate' | 'warn'> = { gate: 'error', warn: 'neutral' }
const TYPE_ICON: Record<'deterministic' | 'llm_judge', React.ComponentType<{ className?: string }>> = {
  deterministic: Binary,
  llm_judge: Sparkles,
}
const SEVERITY_ICON: Record<'gate' | 'warn', React.ComponentType<{ className?: string }>> = {
  gate: OctagonX,
  warn: TriangleAlert,
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function mapRow(item: Record<string, unknown>): AssertionRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const type = readString(item, 'type') === 'llm_judge' ? 'llm_judge' : 'deterministic'
  const severity = readString(item, 'severity') === 'gate' ? 'gate' : 'warn'
  const config = (item.config && typeof item.config === 'object') ? (item.config as Record<string, unknown>) : {}
  const rubric = typeof config.rubric === 'string' ? config.rubric : ''
  const descriptionRaw = item.description ?? null
  const enabledRaw = item.enabled
  return {
    id,
    key: readString(item, 'key'),
    title: readString(item, 'title'),
    description: typeof descriptionRaw === 'string' ? descriptionRaw : null,
    appliesTo: readString(item, 'applies_to', 'appliesTo') || '*',
    type,
    severity,
    rubric,
    enabled: enabledRaw === undefined ? true : Boolean(enabledRaw),
    updatedAt: readString(item, 'updated_at', 'updatedAt') || null,
  }
}

export default function EvalAssertionsPage() {
  const t = useT()
  const [rows, setRows] = React.useState<AssertionRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<AssertionRow | null>(null)
  const [mode, setMode] = React.useState<'list' | 'create' | 'edit'>('list')
  const [agents, setAgents] = React.useState<CrudFieldOption[]>([])

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setIsLoading(true)
    setError(null)
    const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/eval-assertions?pageSize=100',
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) {
      setError(t('agent_orchestrator.evalAssertions.list.error'))
      if (!opts?.silent) setIsLoading(false)
      return
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    setRows(items.map(mapRow).filter((row): row is AssertionRow => !!row))
    if (!opts?.silent) setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const toggleEnabled = React.useCallback(async (row: AssertionRow, next: boolean) => {
    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: next } : item)))
    try {
      await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => updateCrud('agent_orchestrator/eval-assertions', {
          id: row.id,
          key: row.key,
          title: row.title,
          description: row.description ?? undefined,
          appliesTo: row.appliesTo,
          type: row.type,
          severity: row.severity,
          enabled: next,
          config: row.type === 'llm_judge' && row.rubric ? { rubric: row.rubric } : undefined,
        }),
      )
      await load({ silent: true })
    } catch (err) {
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled: row.enabled } : item)))
      if (surfaceRecordConflict(err, t)) return
      flash(t('agent_orchestrator.evalAssertions.flash.toggleError', 'Could not update the assertion'), 'error')
    }
  }, [load, t])

  const formSchema = React.useMemo(
    () =>
      z.object({
        key: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.keyRequired'),
        title: z.string().min(1, 'agent_orchestrator.evalAssertions.form.errors.titleRequired'),
        description: z.string().optional(),
        appliesTo: z.string().min(1),
        type: z.enum(['deterministic', 'llm_judge']),
        severity: z.enum(['gate', 'warn']),
        rubric: z.string().optional(),
        enabled: z.boolean(),
      }),
    [],
  )

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setAgents(
        items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : typeof item.agent_id === 'string' ? item.agent_id : ''
            const label = typeof item.label === 'string' && item.label ? item.label : id
            return { value: id, label }
          })
          .filter((option) => option.value !== ''),
      )
    })
    return () => { cancelled = true }
  }, [])

  const appliesToOptions = React.useMemo<CrudFieldOption[]>(
    () => [{ value: '*', label: t('agent_orchestrator.evalAssertions.form.allAgents', 'All agents') }, ...agents],
    [agents, t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('agent_orchestrator.evalAssertions.form.title'), type: 'text', required: true },
      { id: 'key', label: t('agent_orchestrator.evalAssertions.form.key'), type: 'text', required: true },
      { id: 'description', label: t('agent_orchestrator.evalAssertions.form.description'), type: 'textarea' },
      { id: 'appliesTo', label: t('agent_orchestrator.evalAssertions.form.appliesTo'), type: 'combobox', options: appliesToOptions, seedOptions: appliesToOptions, allowCustomValues: true, required: true },
      {
        id: 'type',
        label: t('agent_orchestrator.evalAssertions.form.type'),
        type: 'select',
        options: [
          { value: 'deterministic', label: t('agent_orchestrator.evalAssertions.type.deterministic') },
          { value: 'llm_judge', label: t('agent_orchestrator.evalAssertions.type.llm_judge') },
        ],
      },
      {
        id: 'severity',
        label: t('agent_orchestrator.evalAssertions.form.severity'),
        type: 'select',
        options: [
          { value: 'gate', label: t('agent_orchestrator.evalAssertions.severity.gate') },
          { value: 'warn', label: t('agent_orchestrator.evalAssertions.severity.warn') },
        ],
        visibleWhen: { field: 'type', equals: 'deterministic' },
      },
      {
        id: 'rubric',
        label: t('agent_orchestrator.evalAssertions.form.rubric'),
        type: 'textarea',
        description: t('agent_orchestrator.evalAssertions.form.rubricHint'),
        visibleWhen: { field: 'type', equals: 'llm_judge' },
      },
      { id: 'enabled', label: t('agent_orchestrator.evalAssertions.form.enabled'), type: 'checkbox' },
    ],
    [t, appliesToOptions],
  )

  const columns = React.useMemo<ColumnDef<AssertionRow>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('agent_orchestrator.evalAssertions.list.col.title'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{row.original.title}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{row.original.key}</div>
          </div>
        ),
      },
      {
        accessorKey: 'appliesTo',
        header: t('agent_orchestrator.evalAssertions.list.col.appliesTo'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.appliesTo}</span>,
      },
      {
        accessorKey: 'type',
        header: t('agent_orchestrator.evalAssertions.list.col.type'),
        cell: ({ row }) => {
          const Icon = TYPE_ICON[row.original.type]
          return (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              {t(`agent_orchestrator.evalAssertions.type.${row.original.type}`)}
            </span>
          )
        },
      },
      {
        accessorKey: 'severity',
        header: t('agent_orchestrator.evalAssertions.list.col.severity'),
        cell: ({ row }) => {
          const Icon = SEVERITY_ICON[row.original.severity]
          return (
            <StatusBadge variant={severityVariant[row.original.severity]} className="gap-1.5">
              <Icon className="size-3.5 shrink-0" />
              {t(`agent_orchestrator.evalAssertions.severity.${row.original.severity}`)}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'enabled',
        header: t('agent_orchestrator.evalAssertions.list.col.enabled'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={row.original.enabled}
              onCheckedChange={(next) => { void toggleEnabled(row.original, next) }}
              aria-label={t('agent_orchestrator.evalAssertions.list.col.enabled')}
            />
          </div>
        ),
      },
    ],
    [t, toggleEnabled],
  )

  function buildBody(values: FormValues) {
    const type = values.type
    const severity = type === 'llm_judge' ? 'warn' : values.severity
    const rubric = typeof values.rubric === 'string' ? values.rubric.trim() : ''
    const body: Record<string, unknown> = {
      key: values.key,
      title: values.title,
      description: values.description?.trim() ? values.description.trim() : undefined,
      appliesTo: values.appliesTo,
      type,
      severity,
      enabled: values.enabled,
      config: type === 'llm_judge' && rubric ? { rubric } : undefined,
    }
    return body
  }

  if (mode !== 'list') {
    const isEdit = mode === 'edit' && editing
    const initialValues: Partial<FormValues> = isEdit
      ? {
          id: editing!.id,
          key: editing!.key,
          title: editing!.title,
          description: editing!.description ?? undefined,
          appliesTo: editing!.appliesTo,
          type: editing!.type,
          severity: editing!.severity,
          rubric: editing!.rubric,
          enabled: editing!.enabled,
          updatedAt: editing!.updatedAt,
        }
      : { appliesTo: '*', type: 'llm_judge', severity: 'warn', enabled: false }

    return (
      <Page>
        <PageBody>
          <div className="max-w-2xl">
          <CrudForm<FormValues>
            title={
              isEdit
                ? t('agent_orchestrator.evalAssertions.form.editTitle')
                : t('agent_orchestrator.evalAssertions.form.createTitle')
            }
            fields={fields}
            initialValues={initialValues}
            entityIds={[ENTITY_ID]}
            schema={formSchema}
            submitLabel={t('agent_orchestrator.evalAssertions.form.submit')}
            cancelHref="/backend/eval-assertions"
            disableOptimisticLock
            onSubmit={async (values) => {
              if (!values.key.trim()) {
                const message = t('agent_orchestrator.evalAssertions.form.errors.keyRequired')
                throw createCrudFormError(message, { key: message })
              }
              const body = buildBody(values)
              try {
                if (isEdit) {
                  await withScopedApiRequestHeaders(
                    buildOptimisticLockHeader(editing!.updatedAt),
                    () => updateCrud('agent_orchestrator/eval-assertions', { id: editing!.id, ...body }),
                  )
                } else {
                  await createCrud('agent_orchestrator/eval-assertions', body)
                }
              } catch (err) {
                if (surfaceRecordConflict(err, t)) return
                throw err
              }
              flash(t('agent_orchestrator.evalAssertions.flash.saved'), 'success')
              setMode('list')
              setEditing(null)
              await load()
            }}
          />
          </div>
        </PageBody>
      </Page>
    )
  }

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('agent_orchestrator.evalAssertions.list.title')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t('agent_orchestrator.evalAssertions.list.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalAssertions.list.subtitle')}</p>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setMode('create') }}>
            <Plus className="mr-2 size-4" />
            {t('agent_orchestrator.evalAssertions.actions.new')}
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={t('agent_orchestrator.evalAssertions.list.empty')}
            description={t('agent_orchestrator.evalAssertions.list.emptyDescription')}
          />
        ) : (
          <DataTable<AssertionRow>
            columns={columns}
            data={rows}
            sortable
            onRowClick={(row) => { setEditing(row); setMode('edit') }}
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('agent_orchestrator.evalAssertions.list.actions.edit'),
                    onSelect: () => { setEditing(row); setMode('edit') },
                  },
                  {
                    id: 'delete',
                    label: t('agent_orchestrator.evalAssertions.list.actions.delete'),
                    destructive: true,
                    onSelect: async () => {
                      try {
                        await withScopedApiRequestHeaders(
                          buildOptimisticLockHeader(row.updatedAt),
                          () => deleteCrud('agent_orchestrator/eval-assertions', row.id),
                        )
                        flash(t('agent_orchestrator.evalAssertions.flash.deleted'), 'success')
                        await load()
                      } catch (err) {
                        if (surfaceRecordConflict(err, t)) return
                        flash(t('agent_orchestrator.evalAssertions.flash.error'), 'error')
                      }
                    },
                  },
                ]}
              />
            )}
          />
        )}
      </PageBody>
    </Page>
  )
}
