'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'
import * as React from 'react'

function OrderConfirmationContent() {
  const searchParams = useSearchParams()
  const orderId = searchParams.get('orderId')

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <CheckCircle size={56} className="mx-auto mb-6 text-green-500" />

      <h1 className="text-2xl font-light tracking-tight text-gray-900 mb-3">
        Order Placed!
      </h1>

      <p className="text-gray-500 mb-2">
        Thank you for your order. We&apos;ll be in touch soon.
      </p>

      {orderId && (
        <p className="text-xs text-gray-400 font-mono mb-8">
          Order ID: {orderId}
        </p>
      )}

      <Link
        href="/"
        className="inline-block rounded bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
      >
        Continue Shopping
      </Link>
    </div>
  )
}

export default function OrderConfirmationPage() {
  return (
    <React.Suspense fallback={<div className="py-20 text-center text-gray-400">Loading…</div>}>
      <OrderConfirmationContent />
    </React.Suspense>
  )
}
