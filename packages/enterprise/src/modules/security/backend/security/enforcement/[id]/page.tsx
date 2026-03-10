'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import EnforcementPolicyForm from '../../../../components/EnforcementPolicyForm'
import type { EnforcementPolicyFormValue } from '../../../../components/EnforcementPolicyForm'
import type { EnforcementPoliciesResponse, EnforcementPolicyDto } from '../_shared'
import { toPayload } from '../_shared'

type SecurityEnforcementEditPageProps = {
  params?: {
    id?: string | string[]
  }
}

function toFormValue(policy: EnforcementPolicyDto): EnforcementPolicyFormValue {
  return {
    id: policy.id,
    scope: policy.scope,
    tenantId: policy.tenantId ?? '',
    organizationId: policy.organizationId ?? '',
    isEnforced: policy.isEnforced,
    allowedMethods: policy.allowedMethods ?? [],
    enforcementDeadline: policy.enforcementDeadline ?? '',
  }
}

export default function SecurityEnforcementEditPage({ params }: SecurityEnforcementEditPageProps) {
  const t = useT()
  const router = useRouter()
  const policyId = React.useMemo(() => {
    if (typeof params?.id === 'string') return params.id
    if (Array.isArray(params?.id)) return params.id[0] ?? ''
    return ''
  }, [params?.id])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [policy, setPolicy] = React.useState<EnforcementPolicyDto | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-enforcement-edit',
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

  const loadPolicy = React.useCallback(async () => {
    if (!policyId) {
      setError(t('security.admin.enforcement.errors.invalidId', 'Invalid enforcement policy id.'))
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    const response = await apiCall<EnforcementPoliciesResponse>('/api/security/enforcement')
    if (!response.ok || !response.result) {
      setPolicy(null)
      setError(
        t(
          'security.admin.enforcement.errors.load',
          'Failed to load enforcement policies.',
        ),
      )
      setLoading(false)
      return
    }

    const found = response.result.items.find((item) => item.id === policyId) ?? null
    if (!found) {
      setPolicy(null)
      setError(
        t('security.admin.enforcement.errors.notFound', 'Enforcement policy not found.'),
      )
      setLoading(false)
      return
    }

    setPolicy(found)
    setLoading(false)
  }, [policyId, t])

  React.useEffect(() => {
    void loadPolicy()
  }, [loadPolicy])

  const handleUpdate = React.useCallback(async (values: EnforcementPolicyFormValue) => {
    if (!policyId) return
    setSaving(true)
    try {
      const payload = toPayload(values)
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/security/enforcement/${encodeURIComponent(policyId)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        payload,
      )
      flash(t('security.admin.enforcement.flash.updated', 'Enforcement policy updated.'), 'success')
      router.push('/backend/security/enforcement')
    } catch {
      flash(t('security.admin.enforcement.flash.updateError', 'Failed to update enforcement policy.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [policyId, router, runMutationWithContext, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        {loading ? (
          <LoadingMessage
            label={t('security.admin.enforcement.loading', 'Loading enforcement policies...')}
          />
        ) : error ? (
          <ErrorMessage
            label={error}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => void loadPolicy()}>
                {t('ui.actions.retry', 'Retry')}
              </Button>
            )}
          />
        ) : policy ? (
          <EnforcementPolicyForm
            backHref="/backend/security/enforcement"
            value={toFormValue(policy)}
            submitting={saving}
            onSubmit={handleUpdate}
            onCancel={() => router.push('/backend/security/enforcement')}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}
