'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useCart } from '@/lib/CartContext'
import {
  createCheckoutSession,
  transitionCheckoutSession,
  cancelCheckoutSession,
} from '@/lib/api'
import type { CheckoutSession } from '@/lib/types'

function formatPrice(amount: string | null, currencyCode: string, locale?: string) {
  if (!amount) return null
  try {
    return new Intl.NumberFormat(locale ?? 'en', {
      style: 'currency',
      currency: currencyCode,
    }).format(parseFloat(amount))
  } catch {
    return `${currencyCode} ${amount}`
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const { cart, cartToken, clearCart } = useCart()

  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isSessionLoading, setIsSessionLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [session, setSession] = React.useState<CheckoutSession | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function bootstrapSession() {
      if (!cartToken || !cart || cart.lines.length === 0) return
      setIsSessionLoading(true)
      try {
        const created = await createCheckoutSession(cartToken, cartToken)
        if (cancelled) return
        setSession(created)

        const existingCustomer = created.customerInfo ?? {}
        setName((existingCustomer.name as string | undefined) ?? '')
        setEmail((existingCustomer.email as string | undefined) ?? '')
        setPhone((existingCustomer.phone as string | undefined) ?? '')
        setAddress((existingCustomer.address as string | undefined) ?? '')
      } catch (err) {
        if (!cancelled) {
          setError(readErrorMessage(err))
        }
      } finally {
        if (!cancelled) setIsSessionLoading(false)
      }
    }
    bootstrapSession()
    return () => {
      cancelled = true
    }
  }, [cartToken, cart?.id, cart?.lines.length])

  function readErrorMessage(err: unknown): string {
    const defaultMessage = 'Failed to process checkout. Please try again.'
    if (!err || typeof err !== 'object') return defaultMessage
    const maybeError = err as Error
    const raw = typeof maybeError.message === 'string' ? maybeError.message : ''
    if (!raw) return defaultMessage
    try {
      const parsed = JSON.parse(raw) as { error?: string }
      return parsed.error ?? defaultMessage
    } catch {
      return raw
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!cartToken || !cart || cart.lines.length === 0) return

    setIsSubmitting(true)
    setError(null)

    try {
      const ensuredSession = session ?? (await createCheckoutSession(cartToken, cartToken))
      setSession(ensuredSession)

      const setCustomerResult = await transitionCheckoutSession(
        ensuredSession.id,
        'set_customer',
        {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
        },
        undefined,
        cartToken,
      )
      setSession(setCustomerResult.session)

      const reviewResult = await transitionCheckoutSession(
        ensuredSession.id,
        'review',
        undefined,
        undefined,
        cartToken,
      )
      setSession(reviewResult.session)

      const placeResult = await transitionCheckoutSession(
        ensuredSession.id,
        'place_order',
        undefined,
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        cartToken,
      )
      setSession(placeResult.session)
      const orderId = placeResult.orderId ?? placeResult.session.placedOrderId
      if (!orderId) {
        throw new Error('Checkout completed without order id')
      }
      clearCart()
      router.push(`/order-confirmation?orderId=${orderId}`)
    } catch (err: unknown) {
      setError(readErrorMessage(err))
      setIsSubmitting(false)
    }
  }

  async function handleCancelSession() {
    if (!session || !cartToken) return
    setIsSubmitting(true)
    setError(null)
    try {
      const result = await cancelCheckoutSession(session.id, cartToken)
      setSession(result.session)
    } catch (err) {
      setError(readErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-light text-gray-900 mb-4">Your cart is empty</h1>
        <Link href="/" className="text-sm text-gray-600 underline">Continue Shopping</Link>
      </div>
    )
  }

  const subtotal = formatPrice(cart.subtotalGross, cart.currencyCode, cart.locale ?? undefined)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <Link
          href="/cart"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Cart
        </Link>
      </div>

      <h1 className="text-2xl font-light tracking-tight text-gray-900 mb-8">Checkout</h1>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
        {/* Form */}
        <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="name">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="jane@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="phone">
              Phone Number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="+1 555 000 0000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="address">
              Shipping Address
            </label>
            <textarea
              id="address"
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="123 Main St, City, State, ZIP"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {session && (
            <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <div>
                Session state: <span className="font-medium text-gray-900">{session.workflowState}</span>
              </div>
              <div>
                Session status: <span className="font-medium text-gray-900">{session.status}</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || isSessionLoading}
            className="w-full rounded bg-gray-900 py-3 text-sm font-medium text-white hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Placing Order…' : isSessionLoading ? 'Preparing checkout…' : 'Place Order'}
          </button>
          {session?.status === 'active' && (
            <button
              type="button"
              onClick={handleCancelSession}
              disabled={isSubmitting}
              className="w-full rounded border border-gray-300 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel Checkout Session
            </button>
          )}
        </form>

        {/* Order Summary */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 p-5 space-y-4">
            <h2 className="text-base font-medium text-gray-900">Order Summary</h2>

            <div className="space-y-3">
              {cart.lines.map((line) => {
                const linePrice = line.unitPriceGross ?? line.unitPriceNet
                const total = linePrice
                  ? formatPrice(
                      (parseFloat(linePrice) * line.quantity).toFixed(4),
                      line.currencyCode ?? cart.currencyCode,
                    )
                  : null
                return (
                  <div key={line.id} className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {line.titleSnapshot ?? 'Product'}{line.quantity > 1 ? ` × ${line.quantity}` : ''}
                    </span>
                    <span className="text-gray-900">{total ?? '—'}</span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-between border-t border-gray-100 pt-3 text-sm font-medium">
              <span className="text-gray-900">Total</span>
              <span className="text-gray-900">{subtotal ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
