'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { ComplianceItem, ComplianceResponse, UserStatus } from '../_shared'
import SecurityUserForm, { type SecurityUserFormValue } from '../../../../components/SecurityUserForm'
import { SudoProvider } from '../../../../components/SudoProvider'
import { useSudoChallenge } from '../../../../components/hooks/useSudoChallenge'

type SecurityUserDetailPageProps = {
  params?: {
    id?: string | string[]
  }
}

function SecurityUserDetailPageInner({ params }: SecurityUserDetailPageProps) {
  const t = useT()
  const router = useRouter()
  const { requireSudo } = useSudoChallenge()
  const userId = React.useMemo(() => {
    if (typeof params?.id === 'string') return params.id
    if (Array.isArray(params?.id)) return params.id[0] ?? ''
    return ''
  }, [params?.id])

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<ComplianceItem | null>(null)
  const [status, setStatus] = React.useState<UserStatus | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-admin-users-detail',
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

  const loadDetail = React.useCallback(async () => {
    if (!userId) {
      setError(t('security.admin.users.errors.invalidUserId', 'Invalid user id.'))
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const [statusResponse, complianceResponse] = await Promise.all([
        apiCall<UserStatus>(`/api/security/users/${encodeURIComponent(userId)}/mfa/status`),
        apiCall<ComplianceResponse>('/api/security/users/mfa/compliance'),
      ])

      if (!statusResponse.ok || !statusResponse.result) {
        setStatus(null)
        setSummary(null)
        setError(t('security.admin.users.errors.status', 'Failed to load user MFA status.'))
        setLoading(false)
        return
      }

      const complianceItems = complianceResponse.ok && complianceResponse.result
        ? complianceResponse.result.items
        : []
      const found = Array.isArray(complianceItems)
        ? complianceItems.find((item) => item.userId === userId) ?? null
        : null

      setStatus(statusResponse.result)
      setSummary(found)
      setLoading(false)
    } catch (loadError) {
      setStatus(null)
      setSummary(null)
      setError(
        normalizeCrudServerError(loadError).message
          ?? t('security.admin.users.errors.status', 'Failed to load user MFA status.'),
      )
      setLoading(false)
    }
  }, [t, userId])

  React.useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const handleReset = React.useCallback(async (values: SecurityUserFormValue) => {
    if (!userId) return
    const reason = values.resetReason.trim()
    if (!reason) {
      flash(t('security.admin.users.errors.reasonRequired', 'Reset reason is required.'), 'error')
      return
    }

    setSaving(true)
    try {
      const sudoToken = await requireSudo('security.admin.mfa.reset')
      if (!sudoToken) {
        flash(t('security.admin.sudo.flash.cancelled', 'Sudo challenge cancelled.'), 'error')
        return
      }

      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/security/users/${encodeURIComponent(userId)}/mfa/reset`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-sudo-token': sudoToken,
            },
            body: JSON.stringify({ reason }),
          }),
        { userId, reason },
      )
      flash(t('security.admin.users.flash.reset', 'User MFA reset completed.'), 'success')
      await loadDetail()
    } catch (resetError) {
      flash(
        normalizeCrudServerError(resetError).message
          ?? t('security.admin.users.flash.resetError', 'Failed to reset user MFA.'),
        'error',
      )
    } finally {
      setSaving(false)
    }
  }, [loadDetail, requireSudo, runMutationWithContext, t, userId])

  const pageTitle = React.useMemo(() => {
    if (summary?.email) {
      return summary.email
    }
    return t('security.admin.users.detail.title', 'User MFA detail')
  }, [summary?.email, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        {loading ? (
          <LoadingMessage label={t('security.admin.users.detail.loading', 'Loading user status...')} />
        ) : error ? (
          <ErrorMessage
            label={error}
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadDetail()}>
                  {t('ui.actions.retry', 'Retry')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/security/users')}>
                  {t('security.admin.users.detail.backToUsers', 'Back to users')}
                </Button>
              </div>
            )}
          />
        ) : status ? (
          <>
            <SecurityUserForm
              value={{
                userId,
                email: summary?.email ?? userId,
                enrolled: status.enrolled,
                recoveryCodesRemaining: status.recoveryCodesRemaining,
                compliant: status.compliant,
                methods: status.methods,
                resetReason: '',
              }}
              submitting={saving}
              onSubmit={handleReset}
              onCancel={() => router.push('/backend/security/users')}
            />
          </>
        ) : (
          <ErrorMessage
            label={t('security.admin.users.detail.unavailable', 'Unable to load user details.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/security/users')}>
                {t('security.admin.users.detail.backToUsers', 'Back to users')}
              </Button>
            )}
          />
        )}
      </PageBody>
    </Page>
  )
}

export default function SecurityUserDetailPage(props: SecurityUserDetailPageProps) {
  return (
    <SudoProvider>
      <SecurityUserDetailPageInner {...props} />
    </SudoProvider>
  )
}
