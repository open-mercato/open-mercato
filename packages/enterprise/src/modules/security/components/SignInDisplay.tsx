'use client'

import type { z } from 'zod'
import type { adminSignInDtoSchema, profileSignInDtoSchema } from '../data/sign-in-query-validators'
import { Monitor, Smartphone, Tablet, Bot } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Badge } from '@open-mercato/ui/primitives/badge'

export type ProfileSignIn = z.infer<typeof profileSignInDtoSchema>
export type AdminSignIn = z.infer<typeof adminSignInDtoSchema>

const reasonLabels = {
  invalid_password: 'security.signIns.reason.invalidPassword',
  invalid_credentials: 'security.signIns.reason.invalidCredentials',
  account_deactivated: 'security.signIns.reason.accountDeactivated',
  tenant_unavailable: 'security.signIns.reason.tenantUnavailable',
  role_denied: 'security.signIns.reason.roleDenied',
  after_interceptor_failed: 'security.signIns.reason.afterInterceptorFailed',
} as const

const mfaLabels = {
  unknown: 'security.signIns.mfa.unknown',
  not_required: 'security.signIns.mfa.notRequired',
  enrollment_required: 'security.signIns.mfa.enrollmentRequired',
  bypassed: 'security.signIns.mfa.bypassed',
  pending: 'security.signIns.mfa.pending',
  verified: 'security.signIns.mfa.verified',
} as const

const deviceIcons = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, bot: Bot, unknown: Monitor }

export function SignInReason({ reason }: { reason: ProfileSignIn['reason'] }) {
  const t = useT()
  if (!reason) return '—'
  if (!Object.hasOwn(reasonLabels, reason)) return t('security.signIns.reason.unknown')
  return t(reasonLabels[reason as keyof typeof reasonLabels])
}

export function SignInMfa({ status }: { status: ProfileSignIn['mfaStatus'] }) {
  const t = useT()
  return status ? t(mfaLabels[status] ?? mfaLabels.unknown) : '—'
}

export function SignInResultBadge({ result }: { result: ProfileSignIn['result'] }) {
  const t = useT()
  return result === 'success'
    ? <Badge variant="success" appearance="light" size="sm">{t('security.signIns.result.success')}</Badge>
    : <Badge variant="error" appearance="light" size="sm">{t('security.signIns.result.failure')}</Badge>
}

export function SignInNewDeviceBadge() {
  const t = useT()
  return <Badge variant="info" appearance="light" size="sm">{t('security.signIns.newDevice')}</Badge>
}

export function SignInDevice({ item, icon = false }: { item: ProfileSignIn; icon?: boolean }) {
  const t = useT()
  const browser = [item.browserName, item.browserMajor].filter(Boolean).join(' ')
  const label = browser && item.osName
    ? t('security.signIns.deviceLabel', { browser, os: item.osName })
    : browser || item.osName || t('security.signIns.unknownDevice')
  const DeviceIcon = deviceIcons[item.deviceType] ?? Monitor
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? <DeviceIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
      {label}
    </span>
  )
}

export function SignInTime({ value, absolute = false }: { value: string; absolute?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const formatted = date.toLocaleString(locale)
  return <time dateTime={value} title={formatted}>{absolute ? formatted : formatRelativeTime(value, { locale, translate: t }) ?? formatted}</time>
}
