'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link.js'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'
import { SignInDevice, SignInMfa, SignInNewDeviceBadge, SignInReason, SignInResultBadge, SignInTime, type AdminSignIn } from '../../../components/SignInDisplay'

type SignInDetailItem = AdminSignIn & { previousSuccessAt: string | null }

function SignInDetailBody({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const [detail, setDetail] = useState<SignInDetailItem | null>(null)
  const [error, setError] = useState<'missing' | 'load' | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void apiCall<SignInDetailItem>(`/api/security/sign-ins/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        if (response.ok && response.result) setDetail(response.result)
        else setError(response.status === 404 ? 'missing' : 'load')
      })
      .catch(() => { if (!controller.signal.aborted) setError('load') })
    return () => controller.abort()
  }, [id])

  if (error) return <ErrorMessage label={error === 'missing' ? t('security.signIns.detail.missing') : t('security.signIns.errors.detail')} />
  if (!detail) return <LoadingMessage label={t('security.signIns.loading')} />

  const fields = [
    [t('security.signIns.column.time'), <SignInTime key="time" value={detail.occurredAt} absolute />],
    [t('security.signIns.column.user'), detail.userName || detail.userId || t('security.signIns.unknownAccount')],
    [t('security.signIns.column.email'), detail.email ?? '—'],
    [t('security.signIns.column.result'), <SignInResultBadge key="result" result={detail.result} />],
    [t('security.signIns.column.reason'), <SignInReason key="reason" reason={detail.reason} />],
    [t('security.signIns.column.mfa'), <SignInMfa key="mfa" status={detail.mfaStatus} />],
    [t('security.signIns.column.ip'), detail.ipAddress ?? '—'],
    [t('security.signIns.column.device'), <SignInDevice key="device" item={detail} />],
    [t('security.signIns.column.newDevice'), detail.isNewDevice ? <SignInNewDeviceBadge key="new-device" /> : '—'],
    [t('security.signIns.detail.previousSuccess'), detail.previousSuccessAt ? <SignInTime key="previous" value={detail.previousSuccessAt} absolute /> : '—'],
    [t('security.signIns.detail.userAgent'), <span key="ua" className="break-all font-mono">{detail.userAgent ?? '—'}</span>],
  ] as const

  return (
    <div className="space-y-4 px-4 py-3">
      <dl className="grid gap-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="grid gap-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {detail.userId ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="font-medium underline underline-offset-4" href={`/backend/security/users/${encodeURIComponent(detail.userId)}`}>
            {t('security.signIns.detail.openUser')}
          </Link>
          <Link className="font-medium underline underline-offset-4" href={`/backend/security/sign-ins?userId=${encodeURIComponent(detail.userId)}`} onClick={onClose}>
            {t('security.signIns.detail.allForUser')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export function SignInDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT()
  return (
    <Sheet open={id !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="overflow-y-auto" closeLabel={t('ui.dialog.close.ariaLabel')}>
        <SheetHeader>
          <SheetTitle>{t('security.signIns.detail.title')}</SheetTitle>
          <SheetDescription>{t('security.signIns.detail.description')}</SheetDescription>
        </SheetHeader>
        {id !== null ? <SignInDetailBody key={id} id={id} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}
