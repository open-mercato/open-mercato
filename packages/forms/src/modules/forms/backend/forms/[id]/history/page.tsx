"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FormDetail = {
  id: string
  name: string
  status: string
  versions: Array<{
    id: string
    versionNumber: number
    status: 'draft' | 'published' | 'archived'
    schemaHash: string
    publishedAt: string | null
    publishedBy: string | null
    changelog: string | null
    createdAt: string
    updatedAt: string
  }>
}

type DiffPayload = {
  base: { id: string; versionNumber: number; schemaHash: string }
  against: { id: string; versionNumber: number; schemaHash: string }
  diff: Array<
    | { kind: 'added'; key: string }
    | { kind: 'removed'; key: string }
    | { kind: 'modified'; key: string; changes: Array<{ path: string; before: unknown; after: unknown }> }
  >
}

const statusVariant: Record<'draft' | 'published' | 'archived', 'warning' | 'success' | 'neutral'> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
}

export default function FormHistoryPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const formId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params!.id[0] : ''

  const [form, setForm] = React.useState<FormDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [baseId, setBaseId] = React.useState<string | null>(null)
  const [againstId, setAgainstId] = React.useState<string | null>(null)
  const [diff, setDiff] = React.useState<DiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)

  React.useEffect(() => {
    if (!formId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const call = await apiCall<FormDetail>(`/api/forms/${encodeURIComponent(formId)}`)
      if (!call.ok || !call.result) {
        if (!cancelled) setError('forms.errors.form_not_found')
      } else if (!cancelled) {
        setForm(call.result)
        if (call.result.versions.length >= 1) setBaseId(call.result.versions[0].id)
        if (call.result.versions.length >= 2) setAgainstId(call.result.versions[1].id)
      }
      if (!cancelled) setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [formId])

  React.useEffect(() => {
    if (!formId || !baseId || !againstId || baseId === againstId) {
      setDiff(null)
      return
    }
    const baseIdSafe: string = baseId
    const againstIdSafe: string = againstId
    let cancelled = false
    async function load() {
      setDiffLoading(true)
      const call = await apiCall<DiffPayload>(
        `/api/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(baseIdSafe)}/diff?against=${encodeURIComponent(againstIdSafe)}`,
      )
      if (!cancelled) {
        if (call.ok && call.result) setDiff(call.result)
        else setDiff(null)
        setDiffLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [formId, baseId, againstId])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('forms.version.history.title')} />
        </PageBody>
      </Page>
    )
  }
  if (error || !form) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t(error ?? 'forms.errors.internal')}
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
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('forms.version.history.title')}</h1>
            <p className="text-sm text-muted-foreground">{form.name}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/backend/forms/${encodeURIComponent(formId)}`}>{t('forms.studio.title')}</Link>
          </Button>
        </header>

        {form.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('forms.version.history.empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
            <ol className="space-y-3">
              {form.versions.map((entry) => (
                <li key={entry.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">v{entry.versionNumber}</span>
                    <Tag variant={statusVariant[entry.status]} dot>
                      {t(`forms.version.history.status${entry.status.charAt(0).toUpperCase()}${entry.status.slice(1)}`)}
                    </Tag>
                  </div>
                  {entry.publishedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('forms.version.history.publishedAt', 'Published {date}', {
                        date: new Date(entry.publishedAt).toLocaleString(),
                      })}
                    </p>
                  )}
                  {entry.changelog && (
                    <p className="mt-2 text-sm">{entry.changelog}</p>
                  )}
                  <div className="mt-3 flex gap-2 text-xs">
                    <Button
                      type="button"
                      variant={baseId === entry.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setBaseId(entry.id)}
                    >
                      Base
                    </Button>
                    <Button
                      type="button"
                      variant={againstId === entry.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setAgainstId(entry.id)}
                    >
                      Against
                    </Button>
                  </div>
                </li>
              ))}
            </ol>

            <section className="rounded-md border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('forms.version.diff.modified')}
              </h2>
              {!baseId || !againstId || baseId === againstId ? (
                <p className="text-sm text-muted-foreground">{t('forms.version.diff.empty')}</p>
              ) : diffLoading ? (
                <LoadingMessage label={t('forms.version.history.title')} />
              ) : !diff || diff.diff.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('forms.version.diff.empty')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {diff.diff.map((entry, idx) => (
                    <li key={`${entry.kind}-${entry.key}-${idx}`} className="rounded-md border border-border p-2">
                      <span className="mr-2 text-xs font-medium uppercase text-muted-foreground">{entry.kind}</span>
                      <span className="font-mono">{entry.key}</span>
                      {entry.kind === 'modified' && (
                        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
                          {JSON.stringify(entry.changes, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
