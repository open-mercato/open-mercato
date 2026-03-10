'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import EnforcementPolicyForm from '../../../../components/EnforcementPolicyForm'
import type { EnforcementPolicyFormValue } from '../../../../components/EnforcementPolicyForm'
import { toPayload } from '../_shared'

export default function SecurityEnforcementCreatePage() {
  const t = useT()
  const router = useRouter()
  const [saving, setSaving] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-enforcement-create',
  })

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { retryLastMutation },
      })
    },
    [retryLastMutation, runMutation],
  )

  const handleCreate = React.useCallback(async (values: EnforcementPolicyFormValue) => {
    setSaving(true)
    try {
      const payload = toPayload(values)
      await runMutationWithContext(
        () =>
          apiCallOrThrow('/api/security/enforcement', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        payload,
      )
      flash(t('security.admin.enforcement.flash.created', 'Enforcement policy created.'), 'success')
      router.push('/backend/security/enforcement')
    } catch {
      flash(t('security.admin.enforcement.flash.createError', 'Failed to create enforcement policy.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [router, runMutationWithContext, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        <EnforcementPolicyForm
          backHref="/backend/security/enforcement"
          submitting={saving}
          onSubmit={handleCreate}
          onCancel={() => router.push('/backend/security/enforcement')}
        />
      </PageBody>
    </Page>
  )
}
