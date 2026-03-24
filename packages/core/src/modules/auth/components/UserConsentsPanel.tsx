"use client"
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import type { ConsentItem } from '@open-mercato/core/modules/auth/lib/consentTypes'

type ConsentsResponse = {
  ok?: boolean
  items?: ConsentItem[]
}

const CONSENT_TYPE_LABELS: Record<string, string> = {
  marketing_email: 'Marketing Email',
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type UserConsentsPanelProps = {
  userId: string
}

export function UserConsentsPanel({ userId }: UserConsentsPanelProps) {
  const t = useT()
  const tRef = React.useRef(t)
  tRef.current = t
  const [consents, setConsents] = React.useState<ConsentItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { ok, result } = await apiCall<ConsentsResponse>(
          `/api/auth/users/consents?userId=${encodeURIComponent(userId)}`,
        )
        if (!cancelled) {
          if (!ok) {
            setError(tRef.current('auth.users.consents.loadError', 'Failed to load consents'))
          } else {
            setConsents(result?.items ?? [])
          }
        }
      } catch {
        if (!cancelled) setError(tRef.current('auth.users.consents.loadError', 'Failed to load consents'))
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('auth.users.consents.loading', 'Loading consents...')}</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  if (consents.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('auth.users.consents.empty', 'No consent records found.')}</p>
  }

  return (
    <div className="space-y-3">
      {consents.map((consent) => (
        <div
          key={consent.id}
          className="rounded-lg border bg-background p-4 text-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">
              {CONSENT_TYPE_LABELS[consent.consentType] ?? consent.consentType}
            </span>
            <span className="flex items-center gap-1.5">
              {consent.isGranted ? (
                <>
                  <ShieldCheck className="size-4 text-emerald-600" />
                  <span className="text-emerald-700 font-medium">
                    {t('auth.users.consents.granted', 'Granted')}
                  </span>
                </>
              ) : (
                <>
                  <ShieldX className="size-4 text-red-500" />
                  <span className="text-red-600 font-medium">
                    {t('auth.users.consents.withdrawn', 'Withdrawn')}
                  </span>
                </>
              )}
            </span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <dt>{t('auth.users.consents.field.grantedAt', 'Granted at')}</dt>
            <dd>{formatDate(consent.grantedAt)}</dd>
            {consent.withdrawnAt && (
              <>
                <dt>{t('auth.users.consents.field.withdrawnAt', 'Withdrawn at')}</dt>
                <dd>{formatDate(consent.withdrawnAt)}</dd>
              </>
            )}
            <dt>{t('auth.users.consents.field.source', 'Source')}</dt>
            <dd>{consent.source ?? '-'}</dd>
            <dt>{t('auth.users.consents.field.ipAddress', 'IP address')}</dt>
            <dd className="font-mono">{consent.ipAddress ?? '-'}</dd>
            <dt>{t('auth.users.consents.field.integrity', 'Integrity')}</dt>
            <dd className="flex items-center gap-1">
              {consent.integrityValid ? (
                <>
                  <ShieldCheck className="size-3 text-emerald-600" />
                  <span className="text-emerald-700">{t('auth.users.consents.integrityValid', 'Valid')}</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="size-3 text-amber-500" />
                  <span className="text-amber-600">{t('auth.users.consents.integrityInvalid', 'Tampered or missing')}</span>
                </>
              )}
            </dd>
            <dt>{t('auth.users.consents.field.createdAt', 'Created')}</dt>
            <dd>{formatDate(consent.createdAt)}</dd>
          </dl>
        </div>
      ))}
    </div>
  )
}
