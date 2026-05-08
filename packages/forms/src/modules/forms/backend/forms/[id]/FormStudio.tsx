"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const FIELD_PALETTE = [
  { type: 'text', jsonType: 'string' },
  { type: 'textarea', jsonType: 'string' },
  { type: 'number', jsonType: 'number' },
  { type: 'integer', jsonType: 'integer' },
  { type: 'boolean', jsonType: 'boolean' },
  { type: 'date', jsonType: 'string' },
  { type: 'datetime', jsonType: 'string' },
  { type: 'select_one', jsonType: 'string' },
  { type: 'select_many', jsonType: 'array' },
  { type: 'scale', jsonType: 'integer' },
  { type: 'info_block', jsonType: 'string' },
] as const

type FieldNode = {
  type: string | string[]
  'x-om-type': string
  'x-om-label'?: { [locale: string]: string }
  'x-om-help'?: { [locale: string]: string }
  'x-om-editable-by'?: string[]
  'x-om-visible-to'?: string[]
  'x-om-sensitive'?: boolean
  [key: string]: unknown
}

type FormSchema = {
  type: 'object'
  'x-om-roles'?: string[]
  'x-om-default-actor-role'?: string
  'x-om-sections'?: Array<{
    key: string
    title: { [locale: string]: string }
    fieldKeys: string[]
  }>
  properties: Record<string, FieldNode>
  required?: string[]
}

type VersionDetail = {
  id: string
  formId: string
  versionNumber: number
  status: 'draft' | 'published' | 'archived'
  schema: FormSchema
  uiSchema: Record<string, unknown>
  roles: string[]
  schemaHash: string
  registryVersion: string
  publishedAt: string | null
  publishedBy: string | null
  changelog: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

type FormDetail = {
  id: string
  key: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'archived'
  defaultLocale: string
  supportedLocales: string[]
  currentPublishedVersionId: string | null
  versions: Array<{
    id: string
    versionNumber: number
    status: 'draft' | 'published' | 'archived'
    schemaHash: string
    publishedAt: string | null
    changelog: string | null
  }>
}

const DEFAULT_SCHEMA: FormSchema = {
  type: 'object',
  'x-om-roles': ['admin'],
  'x-om-default-actor-role': 'admin',
  'x-om-sections': [],
  properties: {},
  required: [],
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function autosaveDebounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function FormStudio({ formId }: { formId: string }) {
  const t = useT()
  const router = useRouter()

  const [form, setForm] = React.useState<FormDetail | null>(null)
  const [draftVersionId, setDraftVersionId] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState<VersionDetail | null>(null)
  const [schema, setSchema] = React.useState<FormSchema>(DEFAULT_SCHEMA)
  const [selectedFieldKey, setSelectedFieldKey] = React.useState<string | null>(null)
  const [previewRole, setPreviewRole] = React.useState<string>('admin')
  const [autosaveState, setAutosaveState] = React.useState<'idle' | 'saving' | 'error'>('idle')
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showPublishDialog, setShowPublishDialog] = React.useState(false)

  const reload = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const formCall = await apiCall<FormDetail>(`/api/forms/${encodeURIComponent(formId)}`)
    if (!formCall.ok || !formCall.result) {
      setLoadError('forms.errors.form_not_found')
      setIsLoading(false)
      return
    }
    const detail = formCall.result
    setForm(detail)
    let draft = detail.versions.find((entry) => entry.status === 'draft') ?? null

    if (!draft) {
      // No draft yet — fork one automatically so the studio always has a draft.
      const forkCall = await apiCall<{ versionId: string }>(
        `/api/forms/${encodeURIComponent(formId)}/versions/fork`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (forkCall.ok && forkCall.result?.versionId) {
        const refresh = await apiCall<FormDetail>(`/api/forms/${encodeURIComponent(formId)}`)
        if (refresh.ok && refresh.result) {
          setForm(refresh.result)
          draft = refresh.result.versions.find((entry) => entry.id === forkCall.result?.versionId) ?? null
        }
      }
    }

    if (draft) {
      setDraftVersionId(draft.id)
      const versionCall = await apiCall<VersionDetail>(
        `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draft.id)}`,
      )
      if (versionCall.ok && versionCall.result) {
        setVersion(versionCall.result)
        const loaded = versionCall.result.schema as FormSchema
        setSchema(loaded && loaded.properties ? loaded : DEFAULT_SCHEMA)
      }
    } else {
      setVersion(null)
      setSchema(DEFAULT_SCHEMA)
    }
    setIsLoading(false)
  }, [formId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const persistDraft = React.useMemo(() => autosaveDebounce(async (next: FormSchema) => {
    if (!draftVersionId) return
    setAutosaveState('saving')
    const call = await apiCall(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draftVersionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ schema: next }),
      },
    )
    if (!call.ok) {
      setAutosaveState('error')
      const errPayload = call.result as { error?: string } | undefined
      flash(errPayload?.error ?? 'forms.studio.autosave.error', 'error')
      return
    }
    setAutosaveState('idle')
    // Refresh schemaHash from the server response (best-effort)
    const refreshed = await apiCall<VersionDetail>(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(draftVersionId)}`,
    )
    if (refreshed.ok && refreshed.result) setVersion(refreshed.result)
  }, 2000), [draftVersionId, formId])

  const updateSchema = React.useCallback((updater: (current: FormSchema) => FormSchema) => {
    setSchema((current) => {
      const next = updater(current)
      void persistDraft(next)
      return next
    })
  }, [persistDraft])

  const handleAddField = React.useCallback((typeKey: string) => {
    updateSchema((current) => {
      const newKey = `field_${Object.keys(current.properties).length + 1}`
      const palette = FIELD_PALETTE.find((entry) => entry.type === typeKey)
      const fieldNode: FieldNode = {
        type: palette?.jsonType ?? 'string',
        'x-om-type': typeKey,
        'x-om-label': { en: 'New field' },
        'x-om-editable-by': ['admin'],
      }
      const next = deepClone(current)
      next.properties[newKey] = fieldNode
      next.required = next.required ?? []
      setSelectedFieldKey(newKey)
      return next
    })
  }, [updateSchema])

  const handleDeleteField = React.useCallback((fieldKey: string) => {
    updateSchema((current) => {
      const next = deepClone(current)
      delete next.properties[fieldKey]
      next.required = (next.required ?? []).filter((entry) => entry !== fieldKey)
      return next
    })
    setSelectedFieldKey(null)
  }, [updateSchema])

  const handleFieldUpdate = React.useCallback((fieldKey: string, updater: (node: FieldNode) => FieldNode) => {
    updateSchema((current) => {
      const next = deepClone(current)
      const node = next.properties[fieldKey]
      if (!node) return current
      next.properties[fieldKey] = updater(node)
      return next
    })
  }, [updateSchema])

  const handleRequiredToggle = React.useCallback((fieldKey: string, required: boolean) => {
    updateSchema((current) => {
      const next = deepClone(current)
      const requiredList = new Set(next.required ?? [])
      if (required) requiredList.add(fieldKey)
      else requiredList.delete(fieldKey)
      next.required = Array.from(requiredList)
      return next
    })
  }, [updateSchema])

  const declaredRoles = React.useMemo(
    () => (schema['x-om-roles'] ?? []).filter((entry): entry is string => typeof entry === 'string'),
    [schema],
  )
  const previewRoles = React.useMemo(() => {
    const all = new Set<string>(['admin'])
    declaredRoles.forEach((entry) => all.add(entry))
    return Array.from(all)
  }, [declaredRoles])

  const selectedField = selectedFieldKey ? schema.properties[selectedFieldKey] : null

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('forms.studio.title')} />
        </PageBody>
      </Page>
    )
  }
  if (loadError || !form) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t(loadError ?? 'forms.errors.internal')}
            action={(
              <Button asChild variant="outline">
                <Link href="/backend/forms">{t('forms.list.title')}</Link>
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <header className="mb-6 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{form.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{form.key}</span>
              <span className="mx-2">·</span>
              <span>{t('forms.studio.schemaHashLabel')}: <span className="font-mono">{(version?.schemaHash ?? '').slice(0, 12) || '—'}</span></span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Tag variant={version?.status === 'published' ? 'success' : 'warning'} dot>
              {t(version?.status === 'published'
                ? 'forms.studio.statusPublished'
                : version?.status === 'archived'
                  ? 'forms.studio.statusArchived'
                  : 'forms.studio.statusDraft')}
            </Tag>
            <span className="text-xs text-muted-foreground">
              {autosaveState === 'saving'
                ? t('forms.studio.autosave.saving')
                : autosaveState === 'error'
                  ? t('forms.studio.autosave.error')
                  : t('forms.studio.autosave.idle')}
            </span>
            <Button asChild variant="outline">
              <Link href={`/backend/forms/${encodeURIComponent(formId)}/history`}>
                {t('forms.studio.actions.history')}
              </Link>
            </Button>
            <Button onClick={() => setShowPublishDialog(true)} disabled={!draftVersionId}>
              {t('forms.studio.actions.publish')}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_320px]">
          <aside className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('forms.studio.panes.tree')}
            </h2>
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                {t('forms.studio.fieldPalette.title')}
              </h3>
              <div className="grid grid-cols-2 gap-1">
                {FIELD_PALETTE.map((entry) => (
                  <Button
                    key={entry.type}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddField(entry.type)}
                  >
                    {entry.type}
                  </Button>
                ))}
              </div>
            </div>
            <ol className="space-y-1">
              {Object.keys(schema.properties).length === 0 ? (
                <li className="text-xs text-muted-foreground">{t('forms.studio.empty')}</li>
              ) : (
                Object.entries(schema.properties).map(([key, node]) => (
                  <li key={key}>
                    <button
                      type="button"
                      className={
                        'flex w-full items-center justify-between rounded-md border border-transparent px-2 py-1 text-left text-sm hover:border-border hover:bg-muted/40' +
                        (selectedFieldKey === key ? ' bg-muted/60 font-medium' : '')
                      }
                      onClick={() => setSelectedFieldKey(key)}
                    >
                      <span className="truncate">{(node['x-om-label']?.en as string) ?? key}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{node['x-om-type']}</span>
                    </button>
                  </li>
                ))
              )}
            </ol>
          </aside>

          <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('forms.studio.panes.preview')}
              </h2>
              <div className="flex items-center gap-2 text-xs">
                <span>{t('forms.studio.previewAs')}</span>
                <Select value={previewRole} onValueChange={setPreviewRole}>
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {previewRoles.map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-3">
              {Object.entries(schema.properties).map(([key, node]) => {
                const visibleTo = (node['x-om-visible-to'] as string[] | undefined)
                  ?? Array.from(new Set([...(node['x-om-editable-by'] as string[] | undefined) ?? ['admin'], 'admin']))
                if (!visibleTo.includes(previewRole)) return null
                const editableBy = (node['x-om-editable-by'] as string[] | undefined) ?? ['admin']
                const canEdit = editableBy.includes(previewRole)
                const label = (node['x-om-label']?.en as string) ?? key
                return (
                  <div key={key} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">{label}</label>
                      {!canEdit && <span className="text-xs text-muted-foreground">read-only</span>}
                    </div>
                    {node['x-om-type'] === 'boolean' ? (
                      <Checkbox disabled={!canEdit} aria-label={label} />
                    ) : node['x-om-type'] === 'textarea' || node['x-om-type'] === 'info_block' ? (
                      <Textarea readOnly={!canEdit} rows={2} />
                    ) : (
                      <Input readOnly={!canEdit} type={node.type === 'number' || node.type === 'integer' ? 'number' : 'text'} />
                    )}
                  </div>
                )
              })}
              {Object.keys(schema.properties).length === 0 && (
                <p className="text-sm text-muted-foreground">{t('forms.studio.empty')}</p>
              )}
            </div>
          </section>

          <aside className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('forms.studio.panes.properties')}
            </h2>
            {!selectedField || !selectedFieldKey ? (
              <p className="text-sm text-muted-foreground">{t('forms.studio.empty')}</p>
            ) : (
              <PropertiesPanel
                fieldKey={selectedFieldKey}
                node={selectedField}
                required={(schema.required ?? []).includes(selectedFieldKey)}
                onUpdate={(updater) => handleFieldUpdate(selectedFieldKey, updater)}
                onRequiredChange={(value) => handleRequiredToggle(selectedFieldKey, value)}
                onDelete={() => handleDeleteField(selectedFieldKey)}
                t={t}
              />
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium uppercase text-muted-foreground">
                {t('forms.studio.compiledJson')}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                {selectedField ? stableJsonStringify(selectedField) : '{}'}
              </pre>
            </details>
          </aside>
        </div>

        {showPublishDialog && draftVersionId && (
          <PublishDialog
            formId={formId}
            versionId={draftVersionId}
            onClose={() => setShowPublishDialog(false)}
            onPublished={() => {
              setShowPublishDialog(false)
              flash(t('forms.studio.actions.publish'), 'success')
              router.push(`/backend/forms/${encodeURIComponent(formId)}/history`)
            }}
            t={t}
          />
        )}
      </PageBody>
    </Page>
  )
}

type PropertiesPanelProps = {
  fieldKey: string
  node: FieldNode
  required: boolean
  onUpdate: (updater: (node: FieldNode) => FieldNode) => void
  onRequiredChange: (value: boolean) => void
  onDelete: () => void
  t: ReturnType<typeof useT>
}

function PropertiesPanel({ fieldKey, node, required, onUpdate, onRequiredChange, onDelete, t }: PropertiesPanelProps) {
  const label = (node['x-om-label']?.en as string) ?? ''
  const help = (node['x-om-help']?.en as string) ?? ''
  const editableBy = (node['x-om-editable-by'] as string[] | undefined) ?? ['admin']
  const visibleTo = (node['x-om-visible-to'] as string[] | undefined) ?? []
  const sensitive = node['x-om-sensitive'] === true
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.label')}</label>
        <Input
          value={label}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-label': { ...(current['x-om-label'] ?? {}), en: event.target.value },
          }))}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.help')}</label>
        <Textarea
          rows={2}
          value={help}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-help': { ...(current['x-om-help'] ?? {}), en: event.target.value },
          }))}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.editableBy')}</label>
        <Input
          value={editableBy.join(', ')}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-editable-by': event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
          }))}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">{t('forms.studio.fields.visibleTo')}</label>
        <Input
          value={visibleTo.join(', ')}
          onChange={(event) => onUpdate((current) => ({
            ...current,
            'x-om-visible-to': event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
          }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={required} onCheckedChange={(value) => onRequiredChange(Boolean(value))} />
        {t('forms.studio.fields.required')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={sensitive}
          onCheckedChange={(value) => onUpdate((current) => ({ ...current, 'x-om-sensitive': Boolean(value) }))}
        />
        {t('forms.studio.fields.sensitive')}
      </label>
      <p className="font-mono text-xs text-muted-foreground">{fieldKey}</p>
      <Button type="button" variant="outline" onClick={onDelete}>
        Delete field
      </Button>
    </div>
  )
}

type PublishDialogProps = {
  formId: string
  versionId: string
  onClose: () => void
  onPublished: () => void
  t: ReturnType<typeof useT>
}

function PublishDialog({ formId, versionId, onClose, onPublished, t }: PublishDialogProps) {
  const [changelog, setChangelog] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changelog, busy])

  async function submit() {
    if (busy) return
    setBusy(true)
    const call = await apiCall<{ versionId: string }>(
      `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(versionId)}/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ changelog: changelog.trim() || null }),
      },
    )
    setBusy(false)
    if (!call.ok) {
      const errPayload = call.result as { error?: string } | undefined
      flash(errPayload?.error ?? 'forms.errors.internal', 'error')
      return
    }
    onPublished()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
      <div className="w-full max-w-lg rounded-md border border-border bg-card p-5 shadow-lg">
        <h2 className="text-lg font-semibold">{t('forms.version.publish.title')}</h2>
        <p className="mt-3 rounded-md border border-status-warning-border bg-status-warning-soft px-3 py-2 text-sm text-status-warning-foreground">
          {t('forms.version.publish.reassurance')}
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">{t('forms.version.publish.changelog')}</label>
          <Textarea
            rows={4}
            value={changelog}
            placeholder={t('forms.version.publish.changelogPlaceholder')}
            onChange={(event) => setChangelog(event.target.value)}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('forms.version.publish.blastRadius')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('forms.version.publish.actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t('forms.version.publish.actions.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
