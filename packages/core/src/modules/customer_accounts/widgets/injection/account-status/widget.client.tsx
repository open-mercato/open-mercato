"use client"

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface AccountStatusData {
  id: string
  email: string
  isActive: boolean
  emailVerified: boolean
  lastLoginAt: string | null
}

interface AccountStatusProps {
  context?: {
    entityId?: string
    recordId?: string
  }
}

export default function AccountStatusWidget({ context }: AccountStatusProps) {
  const t = useT()
  const personEntityId = context?.recordId

  const { data, isLoading } = useQuery({
    queryKey: ['customer-account-status', personEntityId],
    queryFn: async (): Promise<AccountStatusData | null> => {
      if (!personEntityId) return null
      const result = await apiCall(`/api/customer_accounts/admin/users?personEntityId=${personEntityId}&pageSize=1`)
      if (!result.ok) return null
      const json = result.result as Record<string, unknown> | null
      const items = json?.items as AccountStatusData[] | undefined
      return items?.[0] || null
    },
    enabled: !!personEntityId,
  })

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (!data) {
    return (
      <div className="rounded-md border p-3">
        <div className="text-sm font-medium mb-1">{t('customer_accounts.widgets.accountStatus', 'Portal Account')}</div>
        <div className="text-sm text-muted-foreground">{t('customer_accounts.widgets.noAccount', 'No portal account linked')}</div>
      </div>
    )
  }

  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium mb-2">{t('customer_accounts.widgets.accountStatus', 'Portal Account')}</div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('common.status', 'Status')}</span>
          <span className={data.isActive ? 'text-green-600' : 'text-red-600'}>
            {data.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('common.email', 'Email')}</span>
          <span>{data.email}</span>
        </div>
        {data.emailVerified !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('customer_accounts.widgets.emailVerified', 'Email Verified')}</span>
            <span>{data.emailVerified ? '✓' : '✗'}</span>
          </div>
        )}
        {data.lastLoginAt && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('customer_accounts.widgets.lastLogin', 'Last Login')}</span>
            <span>{new Date(data.lastLoginAt).toLocaleDateString()}</span>
          </div>
        )}
      </div>
      <div className="mt-2">
        <a
          href={`/backend/customer_accounts/${data.id}`}
          className="text-xs text-primary hover:underline"
        >
          {t('customer_accounts.widgets.viewAccount', 'View account details →')}
        </a>
      </div>
    </div>
  )
}
