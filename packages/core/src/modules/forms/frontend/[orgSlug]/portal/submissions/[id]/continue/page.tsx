"use client"

import * as React from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { FormRunner } from '../../../../../../ui/public'

export default function PortalSubmissionContinuePage() {
  const params = useParams<{ orgSlug: string; id: string }>()
  const search = useSearchParams()
  const orgSlug = String(params?.orgSlug ?? '')
  const submissionId = String(params?.id ?? '')
  const formKey = String(search?.get('formKey') ?? '')
  const subjectType = String(search?.get('subjectType') ?? 'customer')
  const { user, logout } = useCustomerAuth(orgSlug)
  const subjectId = user?.id ?? ''

  return (
    <PortalShell
      orgSlug={orgSlug}
      authenticated={!!user}
      onLogout={logout}
      enableEventBridge
    >
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        {formKey && subjectId ? (
          <FormRunner
            formKey={formKey}
            subjectType={subjectType}
            subjectId={subjectId}
            initialSubmissionId={submissionId}
            onReturnHome={() => {
              if (typeof window !== 'undefined') {
                window.location.href = `/${orgSlug}/portal`
              }
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </main>
    </PortalShell>
  )
}
