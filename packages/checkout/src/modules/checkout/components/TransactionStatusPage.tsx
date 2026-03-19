"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type TransactionStatusPageProps = {
  variant: 'success' | 'cancel'
  slug?: string
  transactionId?: string
}

function normalizeStatus(status: string | null, variant: 'success' | 'cancel', t: ReturnType<typeof useT>) {
  if (!status) {
    return {
      title: variant === 'success'
        ? t('checkout.statusPage.success.processing', 'Payment processing')
        : t('checkout.statusPage.cancel.cancelled', 'Payment cancelled'),
      statusLabel: t('checkout.statusPage.status.pending', 'Pending'),
    }
  }

  if (variant === 'success') {
    if (status === 'completed') {
      return {
        title: t('checkout.statusPage.success.completed', 'Payment completed'),
        statusLabel: t('checkout.statusPage.status.completed', 'Completed'),
      }
    }
    if (status === 'failed') {
      return {
        title: t('checkout.statusPage.cancel.failed', 'Payment failed'),
        statusLabel: t('checkout.statusPage.status.failed', 'Failed'),
      }
    }
    return {
      title: t('checkout.statusPage.success.processing', 'Payment processing'),
      statusLabel: t(`checkout.statusPage.status.${status}`, status),
    }
  }

  if (status === 'failed') {
    return {
      title: t('checkout.statusPage.cancel.failed', 'Payment failed'),
      statusLabel: t('checkout.statusPage.status.failed', 'Failed'),
    }
  }

  return {
    title: t('checkout.statusPage.cancel.cancelled', 'Payment cancelled'),
    statusLabel: t(`checkout.statusPage.status.${status}`, status),
  }
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
  const [status, setStatus] = React.useState<string | null>(null)
  const [isChecking, setIsChecking] = React.useState(true)

  React.useEffect(() => {
    if (!slug || !transactionId) return
    let active = true

    const loadStatus = async () => {
      try {
        const result = await readApiResultOrThrow<{ status: string }>(
          `/api/checkout/pay/${encodeURIComponent(slug)}/status/${encodeURIComponent(transactionId)}`,
        )
        if (!active) return
        setStatus(result.status)
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

  const statusCopy = normalizeStatus(status, variant, t)

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-12">
      <Card className="w-full rounded-[28px] border-white/70 bg-white/95 shadow-xl">
        <CardContent className="space-y-6 p-8 text-center sm:p-10">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-border/70 bg-muted/20">
            {isChecking || (variant === 'success' && status !== 'completed' && status !== 'failed') ? (
              <Spinner size="sm" />
            ) : (
              <span className="text-xl font-semibold">{variant === 'success' ? 'OK' : '!'}</span>
            )}
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">{statusCopy.title}</h1>
            <p className="text-sm text-muted-foreground">
              {isChecking
                ? t('checkout.statusPage.checking', 'Checking payment status...')
                : t('checkout.statusPage.currentStatus', 'Current status: {status}', {
                    status: statusCopy.statusLabel,
                  })}
            </p>
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
