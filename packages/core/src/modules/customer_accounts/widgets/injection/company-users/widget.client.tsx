"use client"

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface CompanyUser {
  id: string
  displayName: string
  email: string
  isActive: boolean
}

interface CompanyUsersProps {
  context?: {
    entityId?: string
    recordId?: string
  }
}

export default function CompanyUsersWidget({ context }: CompanyUsersProps) {
  const t = useT()
  const customerEntityId = context?.recordId

  const { data, isLoading } = useQuery({
    queryKey: ['customer-company-users', customerEntityId],
    queryFn: async (): Promise<CompanyUser[]> => {
      if (!customerEntityId) return []
      const result = await apiCall(`/api/customer_accounts/admin/users?customerEntityId=${customerEntityId}&pageSize=50`)
      if (!result.ok) return []
      const json = result.result as Record<string, unknown> | null
      return (json?.items as CompanyUser[]) || []
    },
    enabled: !!customerEntityId,
  })

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  const users = data || []

  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium mb-2">
        {t('customer_accounts.widgets.portalUsers', 'Portal Users')}
        {users.length > 0 && <span className="ml-1 text-muted-foreground">({users.length})</span>}
      </div>
      {users.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t('customer_accounts.widgets.noUsers', 'No portal users for this company')}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.id} className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{user.displayName}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${user.isActive ? 'text-green-600' : 'text-red-600'}`}>
                  {user.isActive ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                </span>
                <a
                  href={`/backend/customer_accounts/users/${user.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  {t('common.view', 'View')}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
