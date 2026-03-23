"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type TransactionStatusPageProps = {
  variant: 'success' | 'cancel'
  slug?: string
  transactionId?: string
}

type StatusResponse = {
  status: string
  paymentStatus?: string | null
  link?: {
    title?: string | null
    successTitle?: string | null
    successMessage?: string | null
    cancelTitle?: string | null
    cancelMessage?: string | null
    errorTitle?: string | null
    errorMessage?: string | null
  } | null
}

type StatusCopy = {
  tone: 'success' | 'error' | 'warning' | 'neutral'
  title: string
  message: string
  statusLabel: string
}

function resolveStatusCopy(
  status: string | null,
  variant: 'success' | 'cancel',
  link: StatusResponse['link'],
  t: ReturnType<typeof useT>,
): StatusCopy {
  const linkTitle = link?.title ?? t('checkout.statusPage.defaultLinkTitle', 'this payment')

  if (status === 'completed') {
    return {
      tone: 'success',
      title: link?.successTitle ?? t('checkout.statusPage.success.completed', 'Payment completed'),
      message: link?.successMessage ?? t(
        'checkout.statusPage.success.message',
        'Your payment for {linkTitle} has been confirmed.',
        { linkTitle },
      ),
      statusLabel: t('checkout.statusPage.status.completed', 'Completed'),
    }
  }

  if (status === 'failed' || status === 'expired') {
    return {
      tone: 'error',
      title: link?.errorTitle ?? t('checkout.statusPage.cancel.failed', 'Payment failed'),
      message: link?.errorMessage ?? t(
        'checkout.statusPage.error.message',
        "We couldn't complete the payment. Please try again or use another payment method.",
      ),
      statusLabel: t(`checkout.statusPage.status.${status}`, status),
    }
  }

  if (status === 'cancelled') {
    return {
      tone: 'warning',
      title: link?.cancelTitle ?? t('checkout.statusPage.cancel.cancelled', 'Payment cancelled'),
      message: link?.cancelMessage ?? t(
        'checkout.statusPage.cancel.message',
        'The payment was cancelled before it finished. You can return to the payment page any time.',
      ),
      statusLabel: t('checkout.statusPage.status.cancelled', 'Cancelled'),
    }
  }

  return {
    tone: 'neutral',
    title: variant === 'success'
      ? t('checkout.statusPage.success.processing', 'Payment processing')
      : t('checkout.statusPage.cancel.cancelled', 'Payment cancelled'),
    message: t(
      'checkout.statusPage.processing.message',
      "We're still waiting for the final update from the payment provider.",
    ),
    statusLabel: t(`checkout.statusPage.status.${status ?? 'pending'}`, status ?? 'pending'),
  }
}

function StatusIcon({ tone, spinning }: { tone: StatusCopy['tone']; spinning: boolean }) {
  if (spinning) return <Spinner size="sm" />
  if (tone === 'success') return <CheckCircle2 className="size-6" />
  if (tone === 'error') return <XCircle className="size-6" />
  if (tone === 'warning') return <AlertTriangle className="size-6" />
  return <Clock3 className="size-6" />
}

export function TransactionStatusPage({
  variant,
  slug: slugProp,
  transactionId: transactionIdProp,
}: TransactionStatusPageProps) {
  const params = useParams<{ slug: string; transactionId: string }>()
  const router = useRouter()
  const t = useT()
  const slug = slugProp ?? (typeof params?.slug === 'string' ? params.slug : '')
  const transactionId = transactionIdProp ?? (typeof params?.transactionId === 'string' ? params.transactionId : '')
  const [payload, setPayload] = React.useState<StatusResponse | null>(null)
  const [isChecking, setIsChecking] = React.useState(true)

  React.useEffect(() => {
    if (!slug || !transactionId) return
    let active = true

    const loadStatus = async () => {
      try {
        const result = await readApiResultOrThrow<StatusResponse>(
          `/api/checkout/pay/${encodeURIComponent(slug)}/status/${encodeURIComponent(transactionId)}`,
        )
        if (!active) return
        setPayload(result)
      } catch {
        if (!active) return
      } finally {
        if (active) setIsChecking(false)
      }
    }

    void loadStatus()
    const timer = window.setInterval(() => {
      void loadStatus()
    }, 3000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [slug, transactionId])

  const statusCopy = resolveStatusCopy(payload?.status ?? null, variant, payload?.link, t)
  const iconToneClassName = statusCopy.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : statusCopy.tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : statusCopy.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-border/70 bg-muted/20 text-foreground'

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-12">
      <Card className="w-full rounded-[32px] border-white/70 bg-white/95 shadow-xl backdrop-blur">
        <CardContent className="space-y-6 p-8 sm:p-10">
          <div className={cn(
            'mx-auto flex size-16 items-center justify-center rounded-full border',
            iconToneClassName,
          )}>
            <StatusIcon
              tone={statusCopy.tone}
              spinning={isChecking || statusCopy.tone === 'neutral'}
            />
          </div>
          <div className="space-y-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">{statusCopy.title}</h1>
            <p className="text-sm font-medium text-muted-foreground">
              {isChecking
                ? t('checkout.statusPage.checking', 'Checking payment status...')
                : t('checkout.statusPage.currentStatus', 'Current status: {status}', {
                    status: statusCopy.statusLabel,
                  })}
            </p>
            <div className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground [&_a]:font-medium [&_a]:underline [&_p]:m-0">
              <MarkdownContent body={statusCopy.message} format="markdown" />
            </div>
          </div>
          <div className="flex justify-center">
            <Button type="button" className="rounded-2xl px-6" onClick={() => router.push(`/pay/${encodeURIComponent(slug)}`)}>
              {t('checkout.statusPage.backToPayment', 'Back to payment page')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default TransactionStatusPage
