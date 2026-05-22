"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { EmbeddedForm } from '../../../../../ui/public'

export default function PortalFormRunnerPage() {
  const params = useParams<{ orgSlug: string; key: string }>()
  const orgSlug = String(params?.orgSlug ?? '')
  const formKey = String(params?.key ?? '')
  const { user, logout } = useCustomerAuth(orgSlug)
  const subjectType = 'customer'
  const subjectId = user?.id ?? ''

  return (
    <PortalShell
      orgSlug={orgSlug}
      authenticated={!!user}
      onLogout={logout}
      enableEventBridge
    >
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <EmbeddedForm
          source={{ kind: 'portal', formKey, subjectType, subjectId }}
          onReturnHome={() => {
            if (typeof window !== 'undefined') {
              window.location.href = `/${orgSlug}/portal`
            }
          }}
        />
      </main>
    </PortalShell>
  )
}
