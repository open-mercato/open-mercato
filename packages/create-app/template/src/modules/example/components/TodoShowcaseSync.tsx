'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { readTodoShowcase, showcaseSinks, todoShowcaseHostId, todoShowcaseMutationEndpoint } from '../lib/todoShowcaseClient'

const syncSchema = z.object({ status: z.enum(['pending', 'synced', 'failed']) })

export function TodoShowcaseSync({ values, runSectionMutation }: CrudFormGroupComponentProps) {
  const t = useT()
  const id = typeof values.id === 'string' && values.id ? values.id : undefined
  const initial = syncSchema.safeParse(values.showcaseSync).data?.status
  const [status, setStatus] = useState(initial)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => setStatus(initial), [initial, id])
  useEffect(() => {
    if (!id || status !== 'pending') return
    let cancelled = false
    const timer = setInterval(() => {
      void readTodoShowcase(id).then((item) => {
        const next = syncSchema.safeParse(item?._extensions?.example?.__sync).data?.status
        if (!cancelled && next) setStatus(next)
      }).catch(() => {})
    }, 1500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [id, status])

  if (!id || !status) return null
  const sink = showcaseSinks().find(({ kind }) => kind === 'external')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground" role="status">{t(`example.todoShowcase.sync.${status}`)}</p>
      {status === 'failed' && sink && runSectionMutation ? (
        <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={async () => {
          setRetrying(true)
          try {
            const result = await runSectionMutation({
              operation: 'update', requestOperation: 'retry', mutationSurfaceId: `${sink.id}.retry`,
              mutationResourceKind: todoShowcaseHostId, mutationResourceId: id,
            }, `${todoShowcaseMutationEndpoint}/retry?id=${encodeURIComponent(id)}`, {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
            })
            if (!result.ok) await raiseCrudError(result.response)
            setStatus('pending')
            flash(t('example.todoShowcase.sync.queued'), 'success')
          } catch (error) {
            if (!surfaceRecordConflict(error, t)) flash(t('example.todoShowcase.errors.retry'), 'error')
          } finally {
            setRetrying(false)
          }
        }}>{t('example.todoShowcase.sync.retry')}</Button>
      ) : null}
    </div>
  )
}
