"use client"

import * as React from 'react'
import { match } from 'ts-pattern'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ProviderStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'error'
type RatesStatus = 'idle' | 'loading' | 'done' | 'error'
type ShipmentStatus = 'idle' | 'loading' | 'done' | 'error'
type TrackingStatus = 'idle' | 'loading' | 'done' | 'error'
type CancelStatus = 'idle' | 'loading' | 'done' | 'error'

interface Rate {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
}

interface ShipmentRecord {
  shipmentId: string
  trackingNumber: string
  carrierShipmentId: string
  status: string
  labelUrl?: string
}

interface TrackingEvent {
  occurredAt: string
  status: string
  location?: string
}

interface TrackingResult {
  status: string
  events: TrackingEvent[]
}

interface AddressFields {
  countryCode: string
  postalCode: string
  city: string
  line1: string
}

type PackageSizeMode = 'template' | 'custom'

interface PackageInfo {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

interface PackageTemplate {
  id: string
  label: string
  description: string
  dimensions: PackageInfo
}

const INPOST_PROVIDER_KEY = 'inpost'

// Physical dimensions sourced from official InPost API documentation.
// The adapter uses these for the /calculate endpoint; for locker services
// it replaces dimensions with the named template on the InPost side.
const PACKAGE_TEMPLATES: PackageTemplate[] = [
  {
    id: 'small',
    label: 'Small (A)',
    description: '8×38×64 cm, up to 25 kg',
    dimensions: { weightKg: 1, lengthCm: 8, widthCm: 38, heightCm: 64 },
  },
  {
    id: 'medium',
    label: 'Medium (B)',
    description: '19×38×64 cm, up to 25 kg',
    dimensions: { weightKg: 5, lengthCm: 19, widthCm: 38, heightCm: 64 },
  },
  {
    id: 'large',
    label: 'Large (C)',
    description: '41×38×64 cm, up to 25 kg',
    dimensions: { weightKg: 15, lengthCm: 41, widthCm: 38, heightCm: 64 },
  },
  {
    id: 'xlarge',
    label: 'XLarge',
    description: '60×50×80 cm, up to 30 kg',
    dimensions: { weightKg: 25, lengthCm: 60, widthCm: 50, heightCm: 80 },
  },
]

const DEFAULT_ORIGIN: AddressFields = {
  countryCode: 'PL',
  postalCode: '00-718',
  city: 'Warszawa',
  line1: 'ul. Czerniakowska 87A',
}

const DEFAULT_DESTINATION: AddressFields = {
  countryCode: 'PL',
  postalCode: '30-624',
  city: 'Kraków',
  line1: 'ul. Malborska 130',
}

const DEFAULT_CUSTOM_PACKAGE: PackageInfo = {
  weightKg: 1,
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
}

const DEMO_ORDER_ID = '00000000-0000-4000-8000-000000000001'

function AddressForm({
  label,
  value,
  onChange,
}: {
  label: string
  value: AddressFields
  onChange: (next: AddressFields) => void
}) {
  function field(key: keyof AddressFields) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: event.target.value })
  }

  return (
    <fieldset className="rounded-md border p-4">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">Street / line 1</label>
          <input
            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            value={value.line1}
            onChange={field('line1')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">City</label>
          <input
            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            value={value.city}
            onChange={field('city')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Postal code</label>
          <input
            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            value={value.postalCode}
            onChange={field('postalCode')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Country</label>
          <input
            className="w-full rounded border bg-background px-2 py-1.5 text-sm"
            value={value.countryCode}
            onChange={field('countryCode')}
            maxLength={2}
          />
        </div>
      </div>
    </fieldset>
  )
}

export default function InpostDemoPage() {
  const t = useT()

  const [origin, setOrigin] = React.useState<AddressFields>(DEFAULT_ORIGIN)
  const [destination, setDestination] = React.useState<AddressFields>(DEFAULT_DESTINATION)
  const [sizeMode, setSizeMode] = React.useState<PackageSizeMode>('template')
  const [selectedTemplate, setSelectedTemplate] = React.useState<string>('small')
  const [customPackage, setCustomPackage] = React.useState<PackageInfo>(DEFAULT_CUSTOM_PACKAGE)

  const [providerStatus, setProviderStatus] = React.useState<ProviderStatus>('idle')
  const [providerError, setProviderError] = React.useState<string | null>(null)

  const [ratesStatus, setRatesStatus] = React.useState<RatesStatus>('idle')
  const [rates, setRates] = React.useState<Rate[]>([])
  const [ratesError, setRatesError] = React.useState<string | null>(null)
  const [selectedRate, setSelectedRate] = React.useState<Rate | null>(null)

  const [shipmentStatus, setShipmentStatus] = React.useState<ShipmentStatus>('idle')
  const [shipment, setShipment] = React.useState<ShipmentRecord | null>(null)
  const [shipmentError, setShipmentError] = React.useState<string | null>(null)

  const [trackingStatus, setTrackingStatus] = React.useState<TrackingStatus>('idle')
  const [tracking, setTracking] = React.useState<TrackingResult | null>(null)
  const [trackingError, setTrackingError] = React.useState<string | null>(null)

  const [cancelStatus, setCancelStatus] = React.useState<CancelStatus>('idle')
  const [cancelError, setCancelError] = React.useState<string | null>(null)
  const [cancelMessage, setCancelMessage] = React.useState<string | null>(null)

  const [receiverPhone, setReceiverPhone] = React.useState<string>('500000000')
  const [receiverEmail, setReceiverEmail] = React.useState<string>('test@test.pl')
  const [senderPhone, setSenderPhone] = React.useState<string>('500000000')
  const [senderEmail, setSenderEmail] = React.useState<string>('test@test.pl')
  const [targetPoint, setTargetPoint] = React.useState<string>('KRA010')

  function resetRates() {
    setRatesStatus('idle')
    setRates([])
    setRatesError(null)
    setSelectedRate(null)
    setShipmentStatus('idle')
    setShipment(null)
    setShipmentError(null)
    setTrackingStatus('idle')
    setTracking(null)
    setTrackingError(null)
    setCancelStatus('idle')
    setCancelError(null)
    setCancelMessage(null)
  }

  function handleOriginChange(next: AddressFields) {
    setOrigin(next)
    resetRates()
  }

  function handleDestinationChange(next: AddressFields) {
    setDestination(next)
    resetRates()
  }

  function handleSizeModeChange(mode: PackageSizeMode) {
    setSizeMode(mode)
    resetRates()
  }

  function handleTemplateChange(template: string) {
    setSelectedTemplate(template)
    resetRates()
  }

  function handleCustomPackageField(key: keyof PackageInfo) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setCustomPackage((prev: PackageInfo) => ({ ...prev, [key]: parseFloat(event.target.value) || 0 }))
      resetRates()
    }
  }

  function buildPackagePayload(): PackageInfo {
    if (sizeMode === 'template') {
      return PACKAGE_TEMPLATES.find((pt) => pt.id === selectedTemplate)?.dimensions ?? PACKAGE_TEMPLATES[0].dimensions
    }
    return customPackage
  }

  async function handleCheckProvider() {
    setProviderStatus('loading')
    setProviderError(null)
    const res = await apiCall('/api/shipping-carriers/providers', undefined, {})
    if (!res.ok || !res.result) {
      setProviderStatus('error')
      setProviderError(t('carrier_inpost.demo.providerCheckFailed', 'Failed to check providers'))
      return
    }
    const found = (res.result as { providers: { providerKey: string }[] }).providers?.some(
      (p) => p.providerKey === INPOST_PROVIDER_KEY,
    )
    setProviderStatus(found ? 'found' : 'not_found')
  }

  async function handleFetchRates() {
    setRatesStatus('loading')
    setRatesError(null)
    setRates([])
    const res = await apiCall(
      '/api/shipping-carriers/rates',
      {
        method: 'POST',
        body: JSON.stringify({
          providerKey: INPOST_PROVIDER_KEY,
          origin,
          destination,
          packages: [buildPackagePayload()],
          ...(receiverPhone.trim() !== '' ? { receiverPhone: receiverPhone.trim() } : {}),
          ...(receiverEmail.trim() !== '' ? { receiverEmail: receiverEmail.trim() } : {}),
        }),
      },
      {},
    )
    if (!res.ok || !res.result) {
      setRatesStatus('error')
      setRatesError(
        (res.result as { error?: string } | null)?.error ??
        t('carrier_inpost.demo.ratesFailed', 'Failed to fetch rates'),
      )
      return
    }
    const fetchedRates = (res.result as { rates: Rate[] }).rates ?? []
    setRates(fetchedRates)
    setRatesStatus('done')
    if (fetchedRates.length > 0) setSelectedRate(fetchedRates[0])
  }

  async function handleCreateShipment() {
    if (!selectedRate) return
    setShipmentStatus('loading')
    setShipmentError(null)
    const res = await apiCall(
      '/api/shipping-carriers/shipments',
      {
        method: 'POST',
        body: JSON.stringify({
          providerKey: INPOST_PROVIDER_KEY,
          orderId: DEMO_ORDER_ID,
          origin,
          destination,
          packages: [buildPackagePayload()],
          serviceCode: selectedRate.serviceCode,
          labelFormat: 'pdf',
          ...(receiverPhone.trim() !== '' ? { receiverPhone: receiverPhone.trim() } : {}),
          ...(receiverEmail.trim() !== '' ? { receiverEmail: receiverEmail.trim() } : {}),
          ...(senderPhone.trim() !== '' ? { senderPhone: senderPhone.trim() } : {}),
          ...(senderEmail.trim() !== '' ? { senderEmail: senderEmail.trim() } : {}),
          ...(targetPoint.trim() !== '' ? { targetPoint: targetPoint.trim() } : { targetPoint: 'KRA010' }),
        }),
      },
      {},
    )
    if (!res.ok || !res.result) {
      setShipmentStatus('error')
      setShipmentError(
        (res.result as { error?: string } | null)?.error ??
        t('carrier_inpost.demo.shipmentFailed', 'Failed to create shipment'),
      )
      return
    }
    setShipment(res.result as unknown as ShipmentRecord)
    setShipmentStatus('done')
  }

  async function handleTrackShipment() {
    if (!shipment) return
    setTrackingStatus('loading')
    setTrackingError(null)
    const res = await apiCall(
      `/api/shipping-carriers/tracking?providerKey=${INPOST_PROVIDER_KEY}&shipmentId=${shipment.shipmentId}`,
      undefined,
      {},
    )
    if (!res.ok || !res.result) {
      setTrackingStatus('error')
      setTrackingError(
        (res.result as { error?: string } | null)?.error ??
        t('carrier_inpost.demo.trackingFailed', 'Failed to fetch tracking'),
      )
      return
    }
    setTracking(res.result as unknown as TrackingResult)
    setTrackingStatus('done')
  }

  async function handleCancelShipment() {
    if (!shipment) return
    setCancelStatus('loading')
    setCancelError(null)
    setCancelMessage(null)
    const res = await apiCall(
      '/api/shipping-carriers/cancel',
      {
        method: 'POST',
        body: JSON.stringify({
          providerKey: INPOST_PROVIDER_KEY,
          shipmentId: shipment.shipmentId,
        }),
      },
      {},
    )
    if (!res.ok) {
      setCancelStatus('error')
      setCancelError(
        (res.result as { error?: string } | null)?.error ??
        t('carrier_inpost.demo.cancelFailed', 'Failed to cancel shipment'),
      )
      return
    }
    setCancelMessage(t('carrier_inpost.demo.cancelSuccess', 'Shipment cancelled successfully'))
    setCancelStatus('done')
  }

  return (
    <Page>
      <PageBody>
        <FormHeader title={t('carrier_inpost.demo.title', 'InPost Integration Demo')} />

        <div className="space-y-8">
          {/* Section 1: Provider registration */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.providers', 'Provider Registration')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.providersDesc',
                'Verifies that InPost is registered in the shipping carrier registry.',
              )}
            </p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={handleCheckProvider}
              disabled={providerStatus === 'loading'}
            >
              {t('carrier_inpost.demo.action.checkProvider', 'Check provider')}
            </button>
            {match(providerStatus)
              .with('loading', () => (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('carrier_inpost.demo.checking', 'Checking...')}
                </p>
              ))
              .with('found', () => (
                <p className="mt-3 text-sm text-green-600">
                  {t('carrier_inpost.demo.providerFound', 'InPost is registered as a provider.')}
                </p>
              ))
              .with('not_found', () => (
                <p className="mt-3 text-sm text-yellow-600">
                  {t('carrier_inpost.demo.providerNotFound', 'InPost provider not found in registry.')}
                </p>
              ))
              .with('error', () => (
                <p className="mt-3 text-sm text-destructive">{providerError}</p>
              ))
              .with('idle', () => null)
              .exhaustive()}
          </section>

          {/* Section 2: Rate calculator */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.rates', 'Rate Calculator')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.ratesDesc',
                'Configure origin, destination, and parcel size, then fetch live rates from InPost.',
              )}
            </p>

            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AddressForm
                label={t('carrier_inpost.demo.label.origin', 'Origin')}
                value={origin}
                onChange={handleOriginChange}
              />
              <AddressForm
                label={t('carrier_inpost.demo.label.destination', 'Destination')}
                value={destination}
                onChange={handleDestinationChange}
              />
            </div>

            {/* Receiver contact */}
            <fieldset className="mb-5 rounded-md border p-4">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">
                {t('carrier_inpost.demo.label.receiverContact', 'Receiver contact')}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('carrier_inpost.demo.label.receiverPhone', 'Phone')}
                  </label>
                  <input
                    className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    type="tel"
                    value={receiverPhone}
                    onChange={(e) => { setReceiverPhone(e.target.value); resetRates() }}
                    placeholder="e.g. 500000000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('carrier_inpost.demo.label.receiverEmail', 'Email')}
                  </label>
                  <input
                    className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    type="email"
                    value={receiverEmail}
                    onChange={(e) => { setReceiverEmail(e.target.value); resetRates() }}
                    placeholder="e.g. receiver@example.com"
                  />
                </div>
              </div>
            </fieldset>

            {/* Sender contact */}
            <fieldset className="mb-5 rounded-md border p-4">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">
                {t('carrier_inpost.demo.label.senderContact', 'Sender contact')}
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('carrier_inpost.demo.label.senderPhone', 'Phone')}
                  </label>
                  <input
                    className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    type="tel"
                    value={senderPhone}
                    onChange={(e) => { setSenderPhone(e.target.value); resetRates() }}
                    placeholder="e.g. 500000000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t('carrier_inpost.demo.label.senderEmail', 'Email')}
                  </label>
                  <input
                    className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    type="email"
                    value={senderEmail}
                    onChange={(e) => { setSenderEmail(e.target.value); resetRates() }}
                    placeholder="e.g. sender@example.com"
                  />
                </div>
              </div>
            </fieldset>

            {/* Package size */}
            <div className="mb-5">
              <p className="mb-2 text-sm font-medium">
                {t('carrier_inpost.demo.label.packageSize', 'Package size')}
              </p>
              <div className="mb-3 flex gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="sizeMode"
                    checked={sizeMode === 'template'}
                    onChange={() => handleSizeModeChange('template')}
                  />
                  {t('carrier_inpost.demo.sizeMode.template', 'InPost locker template')}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="sizeMode"
                    checked={sizeMode === 'custom'}
                    onChange={() => handleSizeModeChange('custom')}
                  />
                  {t('carrier_inpost.demo.sizeMode.custom', 'Custom dimensions')}
                </label>
              </div>

              {sizeMode === 'template' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PACKAGE_TEMPLATES.map((pt) => (
                    <label
                      key={pt.id}
                      className={`flex cursor-pointer flex-col rounded-md border p-3 ${selectedTemplate === pt.id ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="template"
                          value={pt.id}
                          checked={selectedTemplate === pt.id}
                          onChange={() => handleTemplateChange(pt.id)}
                        />
                        <span className="text-sm font-medium">{pt.label}</span>
                      </div>
                      <p className="mt-1 pl-5 text-xs text-muted-foreground">{pt.description}</p>
                    </label>
                  ))}
                </div>
              )}

              {sizeMode === 'custom' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      { key: 'weightKg', label: 'Weight (kg)' },
                      { key: 'lengthCm', label: 'Length (cm)' },
                      { key: 'widthCm', label: 'Width (cm)' },
                      { key: 'heightCm', label: 'Height (cm)' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                        value={customPackage[key]}
                        onChange={handleCustomPackageField(key)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Locker point — required for locker services when creating a shipment */}
            <div className="mb-5">
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('carrier_inpost.demo.label.targetPoint', 'Locker point ID (required for locker services)')}
              </label>
              <input
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={targetPoint}
                onChange={(e) => { setTargetPoint(e.target.value); resetRates() }}
                placeholder="e.g. KRA010"
              />
            </div>

            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={handleFetchRates}
              disabled={ratesStatus === 'loading'}
            >
              {t('carrier_inpost.demo.action.fetchRates', 'Fetch rates')}
            </button>
            {match(ratesStatus)
              .with('loading', () => (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('carrier_inpost.demo.loadingRates', 'Fetching rates...')}
                </p>
              ))
              .with('error', () => (
                <p className="mt-3 text-sm text-destructive">{ratesError}</p>
              ))
              .with('done', () => (
                <div className="mt-4 space-y-2">
                  {rates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('carrier_inpost.demo.noRates', 'No rates available for this configuration.')}
                    </p>
                  ) : (
                    rates.map((rate) => (
                      <label
                        key={rate.serviceCode}
                        className={`flex cursor-pointer items-center justify-between rounded-md border p-3 ${selectedRate?.serviceCode === rate.serviceCode ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="rate"
                            value={rate.serviceCode}
                            checked={selectedRate?.serviceCode === rate.serviceCode}
                            onChange={() => setSelectedRate(rate)}
                          />
                          <div>
                            <p className="text-sm font-medium">{rate.serviceName}</p>
                            <p className="text-xs text-muted-foreground">{rate.serviceCode}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">
                            {(rate.amount / 100).toFixed(2)} {rate.currencyCode}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              ))
              .with('idle', () => null)
              .exhaustive()}
          </section>

          {/* Section 3: Create shipment */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.shipment', 'Create Test Shipment')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.shipmentDesc',
                'Creates a shipment using the selected rate. Requires rates to be fetched first.',
              )}
            </p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              onClick={handleCreateShipment}
              disabled={!selectedRate || shipmentStatus === 'loading' || shipmentStatus === 'done'}
            >
              {t('carrier_inpost.demo.action.createShipment', 'Create shipment')}
            </button>
            {match(shipmentStatus)
              .with('loading', () => (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('carrier_inpost.demo.creating', 'Creating shipment...')}
                </p>
              ))
              .with('error', () => (
                <p className="mt-3 text-sm text-destructive">{shipmentError}</p>
              ))
              .with('done', () =>
                shipment ? (
                  <div className="mt-4 space-y-1 rounded bg-muted px-3 py-2 text-xs font-mono">
                    <p>id: {shipment.shipmentId}</p>
                    <p>tracking: {shipment.trackingNumber}</p>
                    <p>status: {shipment.status}</p>
                    {shipment.labelUrl && (
                      <p>
                        label:{' '}
                        <a className="text-primary underline" href={shipment.labelUrl} target="_blank" rel="noreferrer">
                          {shipment.labelUrl}
                        </a>
                      </p>
                    )}
                  </div>
                ) : null,
              )
              .with('idle', () => null)
              .exhaustive()}
          </section>

          {/* Section 4: Track shipment */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.tracking', 'Track Shipment')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.trackingDesc',
                'Polls InPost for live tracking status and events. Requires a shipment to be created first.',
              )}
            </p>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              onClick={handleTrackShipment}
              disabled={!shipment || trackingStatus === 'loading'}
            >
              {t('carrier_inpost.demo.action.trackShipment', 'Track shipment')}
            </button>
            {match(trackingStatus)
              .with('loading', () => (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('carrier_inpost.demo.loadingTracking', 'Fetching tracking...')}
                </p>
              ))
              .with('error', () => (
                <p className="mt-3 text-sm text-destructive">{trackingError}</p>
              ))
              .with('done', () =>
                tracking ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm font-medium">
                      {t('carrier_inpost.demo.currentStatus', 'Status')}: {tracking.status}
                    </p>
                    <ul className="space-y-2">
                      {tracking.events.map((event, index) => (
                        <li key={index} className="flex gap-3 text-xs">
                          <span className="text-muted-foreground whitespace-nowrap">{event.occurredAt}</span>
                          <span className="font-medium">{event.status}</span>
                          {event.location && (
                            <span className="text-muted-foreground">@ {event.location}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )
              .with('idle', () => null)
              .exhaustive()}
          </section>

          {/* Section 5: Cancel shipment */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.cancel', 'Cancel Shipment')}
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.cancelDesc',
                'Cancels the created shipment. Returns 422 if the shipment has already moved beyond cancellable status.',
              )}
            </p>
            <button
              className="rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50"
              onClick={handleCancelShipment}
              disabled={!shipment || cancelStatus === 'loading' || cancelStatus === 'done'}
            >
              {t('carrier_inpost.demo.action.cancelShipment', 'Cancel shipment')}
            </button>
            {match(cancelStatus)
              .with('loading', () => (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('carrier_inpost.demo.cancelling', 'Cancelling...')}
                </p>
              ))
              .with('error', () => (
                <p className="mt-3 text-sm text-destructive">{cancelError}</p>
              ))
              .with('done', () => (
                <p className="mt-3 text-sm text-green-600">{cancelMessage}</p>
              ))
              .with('idle', () => null)
              .exhaustive()}
          </section>

          {/* Section 6: Webhook delivery log */}
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 font-semibold text-base">
              {t('carrier_inpost.demo.section.webhooks', 'Webhook Delivery Log')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(
                'carrier_inpost.demo.section.webhooksDesc',
                'InPost sends webhook events to /api/shipping-carriers/webhooks/inpost. The last received event timestamp is stored on each shipment record (lastWebhookAt). Use the InPost dashboard to configure the webhook endpoint URL.',
              )}
            </p>
            {shipment && (
              <div className="mt-4 rounded bg-muted px-3 py-2 text-xs font-mono">
                <p>shipment id: {shipment.shipmentId}</p>
                <p>webhook endpoint: /api/shipping-carriers/webhooks/inpost</p>
              </div>
            )}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
