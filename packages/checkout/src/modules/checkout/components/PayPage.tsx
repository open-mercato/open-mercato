"use client"
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

type PayLinkPayload = {
  name: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  logoUrl?: string | null
  backgroundColor?: string | null
  pricingMode: 'fixed' | 'custom_amount' | 'price_list'
  fixedPriceAmount?: number | null
  fixedPriceCurrencyCode?: string | null
  fixedPriceOriginalAmount?: number | null
  customAmountMin?: number | null
  customAmountMax?: number | null
  customAmountCurrencyCode?: string | null
  priceListItems?: Array<{ id: string; description: string; amount: number; currencyCode: string }>
  customerFieldsSchema?: Array<{ key: string; label: string; kind: string; required: boolean; options?: Array<{ value: string; label: string }> }>
  legalDocuments?: {
    terms?: { markdown?: string; required?: boolean }
    privacyPolicy?: { markdown?: string; required?: boolean }
  }
  requiresPassword?: boolean
  available?: boolean
}

export function PayPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const slug = typeof params?.slug === 'string' ? params.slug : ''
  const [payload, setPayload] = React.useState<PayLinkPayload | null>(null)
  const [password, setPassword] = React.useState('')
  const [customerData, setCustomerData] = React.useState<Record<string, unknown>>({})
  const [acceptedLegalConsents, setAcceptedLegalConsents] = React.useState<Record<string, boolean>>({})
  const [amount, setAmount] = React.useState<number | null>(null)
  const [selectedPriceItemId, setSelectedPriceItemId] = React.useState<string | null>(null)

  const loadPayload = React.useCallback(async () => {
    const result = await readApiResultOrThrow<PayLinkPayload>(`/api/checkout/pay/${encodeURIComponent(slug)}`)
    setPayload(result)
    if (result.pricingMode === 'fixed' && typeof result.fixedPriceAmount === 'number') {
      setAmount(result.fixedPriceAmount)
    }
  }, [slug])

  React.useEffect(() => {
    void loadPayload()
  }, [loadPayload])

  if (!payload) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-sm text-muted-foreground">Loading payment link…</div>
  }
  if (payload.requiresPassword) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardHeader><CardTitle>{payload.title ?? 'Protected payment link'}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
            <Button type="button" onClick={async () => {
              await apiCallOrThrow(`/api/checkout/pay/${encodeURIComponent(slug)}/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
              })
              void loadPayload()
            }}>Continue</Button>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (payload.available === false) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">This payment link is no longer available.</div>
  }

  const selectedPriceItem = payload.priceListItems?.find((item) => item.id === selectedPriceItemId) ?? null
  const effectiveAmount = selectedPriceItem?.amount ?? amount

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: payload.backgroundColor ?? '#f5f3ee' }}>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="space-y-6 p-8">
            {payload.logoUrl ? <img src={payload.logoUrl} alt="" className="h-12 w-auto object-contain" /> : null}
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold">{payload.title ?? payload.name}</h1>
              {payload.subtitle ? <p className="text-muted-foreground">{payload.subtitle}</p> : null}
            </div>
            {payload.description ? <div className="whitespace-pre-wrap text-sm leading-6">{payload.description}</div> : null}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Customer details</h2>
              {(payload.customerFieldsSchema ?? []).map((field) => (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium">{field.label}</label>
                  {field.kind === 'multiline' ? (
                    <Textarea value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))} />
                  ) : field.kind === 'boolean' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={customerData[field.key] === true} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.checked }))} />
                      {field.label}
                    </label>
                  ) : field.kind === 'select' || field.kind === 'radio' ? (
                    <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))}>
                      <option value="">Select…</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <Input value={typeof customerData[field.key] === 'string' ? customerData[field.key] as string : ''} onChange={(event) => setCustomerData((current) => ({ ...current, [field.key]: event.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-6 p-8">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Payment</h2>
              {payload.pricingMode === 'fixed' ? (
                <div className="space-y-1">
                  {typeof payload.fixedPriceOriginalAmount === 'number' ? <div className="text-sm text-muted-foreground line-through">{payload.fixedPriceOriginalAmount.toFixed(2)} {payload.fixedPriceCurrencyCode}</div> : null}
                  <div className="text-3xl font-semibold">{payload.fixedPriceAmount?.toFixed(2)} {payload.fixedPriceCurrencyCode}</div>
                </div>
              ) : null}
              {payload.pricingMode === 'custom_amount' ? (
                <Input type="number" value={effectiveAmount ?? ''} onChange={(event) => setAmount(Number(event.target.value))} placeholder={`${payload.customAmountMin ?? 0} - ${payload.customAmountMax ?? ''}`} />
              ) : null}
              {payload.pricingMode === 'price_list' ? (
                <div className="space-y-2">
                  {(payload.priceListItems ?? []).map((item) => (
                    <label key={item.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                      <span className="flex items-center gap-3">
                        <input type="radio" name="priceItem" checked={selectedPriceItemId === item.id} onChange={() => { setSelectedPriceItemId(item.id); setAmount(item.amount) }} />
                        <span>{item.description}</span>
                      </span>
                      <span className="font-medium">{item.amount.toFixed(2)} {item.currencyCode}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            {(payload.legalDocuments?.terms?.markdown || payload.legalDocuments?.privacyPolicy?.markdown) ? (
              <div className="space-y-3">
                {payload.legalDocuments?.terms?.markdown ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={acceptedLegalConsents.terms === true} onChange={(event) => setAcceptedLegalConsents((current) => ({ ...current, terms: event.target.checked }))} />
                    <span>I accept the terms and conditions.</span>
                  </label>
                ) : null}
                {payload.legalDocuments?.privacyPolicy?.markdown ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={acceptedLegalConsents.privacyPolicy === true} onChange={(event) => setAcceptedLegalConsents((current) => ({ ...current, privacyPolicy: event.target.checked }))} />
                    <span>I accept the privacy policy.</span>
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="text-sm text-muted-foreground">Amount due</div>
              <div className="text-2xl font-semibold">{typeof effectiveAmount === 'number' ? effectiveAmount.toFixed(2) : '0.00'} {selectedPriceItem?.currencyCode ?? payload.fixedPriceCurrencyCode ?? payload.customAmountCurrencyCode ?? ''}</div>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={async () => {
                const result = await readApiResultOrThrow<{ transactionId: string; redirectUrl?: string | null }>(
                  `/api/checkout/pay/${encodeURIComponent(slug)}/submit`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Idempotency-Key': crypto.randomUUID(),
                    },
                    body: JSON.stringify({
                      customerData,
                      acceptedLegalConsents,
                      amount: effectiveAmount,
                      selectedPriceItemId,
                    }),
                  },
                )
                if (result.redirectUrl) {
                  window.location.href = result.redirectUrl
                  return
                }
                router.push(`/pay/${encodeURIComponent(slug)}/success/${encodeURIComponent(result.transactionId)}`)
              }}
            >
              Pay now
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default PayPage
