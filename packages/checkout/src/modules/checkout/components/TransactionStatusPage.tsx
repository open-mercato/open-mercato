"use client"
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'

export function TransactionStatusPage({ variant }: { variant: 'success' | 'cancel' }) {
  const params = useParams<{ slug: string; transactionId: string }>()
  const router = useRouter()
  const slug = typeof params?.slug === 'string' ? params.slug : ''
  const transactionId = typeof params?.transactionId === 'string' ? params.transactionId : ''
  const [status, setStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    const timer = window.setInterval(() => {
      void readApiResultOrThrow<{ status: string }>(`/api/checkout/pay/${encodeURIComponent(slug)}/status/${encodeURIComponent(transactionId)}`)
        .then((result) => {
          if (active) setStatus(result.status)
        })
        .catch(() => null)
    }, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [slug, transactionId])

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <h1 className="text-3xl font-semibold">
        {variant === 'success'
          ? status === 'completed' ? 'Payment completed' : 'Payment processing'
          : status === 'failed' ? 'Payment failed' : 'Payment cancelled'}
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">{status ? `Current status: ${status}` : 'Checking payment status…'}</p>
      <div className="mt-8 flex justify-center">
        <Button type="button" onClick={() => router.push(`/pay/${encodeURIComponent(slug)}`)}>Back to payment page</Button>
      </div>
    </div>
  )
}

export default TransactionStatusPage
