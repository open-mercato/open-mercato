"use client"

import * as React from 'react'
import { navigateWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { EmbeddedForm } from '../../../../../ui/public'

type Props = { params: { orgSlug: string; key: string } }

export default function PortalFormRunnerPage({ params }: Props) {
  // Read from the `params` prop the (frontend) catch-all passes, as every other
  // portal page in the repo does. `useParams()` does NOT work here: under the
  // catch-all the client-side route is `[...slug]`, so it returns `{ slug }`
  // and nothing else — `key` came back undefined, `formKey` was always empty,
  // and this page could never load a form.
  const orgSlug = String(params?.orgSlug ?? '')
  const formKey = String(params?.key ?? '')
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const subjectType = 'customer'
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
      <EmbeddedForm
        source={{ kind: 'portal', formKey, subjectType, subjectId }}
        onReturnHome={() => {
          if (typeof window !== 'undefined') {
            navigateWithPageReload(`/${orgSlug}/portal`)
          }
        }}
      />
    </main>
  )
}
