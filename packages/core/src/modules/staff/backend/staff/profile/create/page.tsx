"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SelfMemberResponse = {
  member?: {
    id?: string
  } | null
}

type SelfProfileValues = {
  displayName?: string | null
  description?: string | null
}

export default function StaffProfileCreatePage() {
  const t = useT()
  const router = useRouter()
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiCall<SelfMemberResponse>('/api/staff/team-members/self')
        const memberId = response.result?.member?.id ?? null
        if (memberId && !cancelled) {
          router.replace('/backend/staff/my-availability')
          return
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('staff.teamMembers.form.errors.load', 'Failed to load team member.')
          setError(message)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [router, t])

  const fields = React.useMemo<CrudField[]>(() => ([
    { id: 'displayName', label: t('staff.teamMembers.form.fields.displayName', 'Display name'), type: 'text', required: true },
    { id: 'description', label: t('staff.teamMembers.form.fields.description', 'Description'), type: 'richtext', editor: 'uiw' },
  ]), [t])

  const handleSubmit = React.useCallback(async (values: SelfProfileValues) => {
    await apiCallOrThrow('/api/staff/team-members/self', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: values.displayName ?? '',
        description: values.description ?? null,
      }),
    })
    flash(t('staff.teamMembers.self.created', 'Profile created.'), 'success')
    router.push('/backend/staff/my-availability')
  }, [router, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage message={t('staff.teamMembers.form.loading', 'Loading team member...')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage message={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<SelfProfileValues>
          title={t('staff.teamMembers.self.createTitle', 'Create my profile')}
          submitLabel={t('staff.teamMembers.form.actions.create', 'Create')}
          backHref="/backend/staff/my-leave-requests"
          cancelHref="/backend/staff/my-leave-requests"
          fields={fields}
          initialValues={{}}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
