'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation.js'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'

import MfaEnrollmentNotice from '../../../../components/MfaEnrollmentNotice'
import { useMfaStatus } from '../../../../components/hooks/useMfaStatus'
import { FormHeader } from '@open-mercato/ui/backend/forms/FormHeader'
import {
  removeMfaEnrollmentNoticeQueryFromHref,
  resolveMfaEnrollmentNotice,
} from '../../../../lib/mfa-enrollment-notice'
import type { MfaProvider } from '../../../../types'
import { useProviderListComponent } from '../../../../components/mfa-ui-registry'
import RecoveryCodesListItem from '../../../../components/mfa-provider-list-items/RecoveryCodesListItem'

type MfaProviderRow = {
  kind: 'provider' | 'recovery_codes'
  provider?: MfaProvider
  configuredCount?: number
}

type ProviderListCellProps = {
  row: MfaProviderRow
  onOpenProvider: (providerType: string) => void
}

function ProviderListCell({ row, onOpenProvider }: ProviderListCellProps) {
  if (row.kind === 'recovery_codes') {
    return <RecoveryCodesListItem onClick={() => onOpenProvider('recovery_codes')} />
  }

  const provider = row.provider
  if (!provider) return null
  const ListComponent = useProviderListComponent(provider)

  return (
    <ListComponent
      provider={provider}
      configuredCount={row.configuredCount ?? 0}
      onClick={() => onOpenProvider(provider.type)}
    />
  )
}

export default function SecurityMfaPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { loading, methods, providers } = useMfaStatus()
  const [showEnrollmentNotice, setShowEnrollmentNotice] = React.useState(false)
  const [showOverdueEnrollmentNotice, setShowOverdueEnrollmentNotice] = React.useState(false)

  React.useEffect(() => {
    const noticeState = resolveMfaEnrollmentNotice(searchParams)
    if (!noticeState.visible) return

    setShowEnrollmentNotice(true)
    setShowOverdueEnrollmentNotice(noticeState.overdue)

    if (typeof window === 'undefined') return
    const nextUrl = removeMfaEnrollmentNoticeQueryFromHref(window.location.href)
    if (!nextUrl) return
    window.history.replaceState(window.history.state, '', nextUrl)
  }, [searchParams])

  const providerRows = React.useMemo<MfaProviderRow[]>(() => {
    const configuredCountByType = new Map<string, number>()
    for (const method of methods) {
      const currentCount = configuredCountByType.get(method.type) ?? 0
      configuredCountByType.set(method.type, currentCount + 1)
    }

    const providerRows: MfaProviderRow[] = providers.map((provider) => ({
      kind: 'provider' as const,
      provider,
      configuredCount: configuredCountByType.get(provider.type) ?? 0,
    }))
    providerRows.push({ kind: 'recovery_codes' })
    return providerRows
  }, [methods, providers])

  const handleOpenProvider = React.useCallback((providerType: string) => {
    if (providerType === 'recovery_codes') {
      router.push('/backend/profile/security/mfa/recovery-codes')
      return
    }
    router.push(`/backend/profile/security/mfa/${encodeURIComponent(providerType)}`)
  }, [router])

  const columns = React.useMemo<ColumnDef<MfaProviderRow>[]>(() => [
    {
      accessorKey: 'provider.type',
      header: t('security.profile.mfa.providers.tableColumn', 'Methods'),
      meta: {
        truncate: false,
        maxWidth: '100%',
      },
      cell: ({ row }) => (
        <ProviderListCell row={row.original} onOpenProvider={handleOpenProvider} />
      ),
    },
  ], [handleOpenProvider, t])

  if (loading) {
    return <LoadingMessage label={t('security.profile.mfa.loading', 'Loading MFA settings...')} />
  }

  return (
    <Page>
      <MfaEnrollmentNotice
        visible={showEnrollmentNotice}
        overdue={showOverdueEnrollmentNotice}
        onDismiss={() => setShowEnrollmentNotice(false)}
      />
      <FormHeader
        mode="detail"
        backHref="/backend/profile/security"
        backLabel={t('security.profile.backToList', 'Back to security settings')}
        title={t('security.profile.mfa.title', 'Multi-factor authentication')}
        subtitle={t('security.profile.mfa.description', 'Manage your MFA methods and recovery codes.')}
      />
      <PageBody>
        <DataTable
          columns={columns}
          data={providerRows}
          emptyState={(
            <EmptyState
              title={t('security.profile.mfa.providers.empty', 'No MFA providers are currently available.')}
            />
          )}
          embedded
        />
      </PageBody>
    </Page>
  )
}
