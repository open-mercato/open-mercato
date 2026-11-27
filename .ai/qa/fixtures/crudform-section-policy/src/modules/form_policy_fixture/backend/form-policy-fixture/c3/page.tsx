'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { FixtureForm } from '../../../runtime/FixtureForm.client'

const fixtureRow = z.object({ id: z.uuid(), region: z.string() })

export default function FixturePage() {
  const t = useT()
  const [region, setRegion] = useState<string>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const id = z.uuid().safeParse(new URLSearchParams(window.location.search).get('fixtureRecordId'))
    if (!id.success) {
      setLoaded(true)
      return
    }
    const controller = new AbortController()
    const query = new URLSearchParams({ entityId: 'form_policy_fixture:record', id: id.data, pageSize: '1' })
    void apiCall<{ items?: unknown[] }>(`/api/entities/records?${query}`, { signal: controller.signal }).then(({ result }) => {
      if (controller.signal.aborted) return
      const record = fixtureRow.safeParse(result?.items?.[0])
      if (record.success && record.data.id === id.data) setRegion(record.data.region)
      setLoaded(true)
    }).catch(() => { if (!controller.signal.aborted) setLoaded(true) })
    return () => controller.abort()
  }, [])

  if (!loaded) return <LoadingMessage label={t('form_policy_fixture.loading')} />
  return <FixtureForm scenario="c3" region={region} onSubmit={(_values, context) => {
    if (!context?.mutation) throw new Error('[internal] No fixture mutation was accepted')
    throw new Error('[internal] The uncovered fixture does not publish a mutation')
  }} />
}
