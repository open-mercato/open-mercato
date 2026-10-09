"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { navigateWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { FormRunner } from '../../../../../../ui/public'

type Props = { params: { orgSlug: string; id: string } }

export default function PortalSubmissionContinuePage({ params }: Props) {
  const t = useT()
  // Route params come from the `params` prop the (frontend) catch-all passes.
  // `useParams()` returns `{ slug }` under the catch-all, so `id` was undefined
  // and this page could never resume a submission. Query-string values still
  // come from `useSearchParams()`, which is unaffected.
  const search = useSearchParams()
  const orgSlug = String(params?.orgSlug ?? '')
  const submissionId = String(params?.id ?? '')
  const formKey = String(search?.get('formKey') ?? '')
  const subjectType = String(search?.get('subjectType') ?? 'customer')
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const subjectId = user?.id ?? ''

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!user) return null

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      {formKey && subjectId ? (
        <FormRunner
          formKey={formKey}
          subjectType={subjectType}
          subjectId={subjectId}
          initialSubmissionId={submissionId}
          onReturnHome={() => {
            if (typeof window !== 'undefined') {
              navigateWithPageReload(`/${orgSlug}/portal`)
            }
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('forms.runner.loading')}</p>
      )}
    </main>
  )
}
