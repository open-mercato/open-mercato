"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Package, CheckCircle2 } from 'lucide-react'
import type { Address, PackageDimension, ShippingRate, LabelFormat, ContactInfo } from '../types'

export type ConfirmStepProps = {
  rates: ShippingRate[]
  ratesError: string | null
  selectedRate: ShippingRate | null
  selectedProvider: string
  origin: Address
  destination: Address
  packages: PackageDimension[]
  labelFormat: LabelFormat
  senderContact: ContactInfo
  receiverContact: ContactInfo
  targetPoint: string
  c2cSendingMethod: string
  isSubmitting: boolean
  onRateSelect: (rate: ShippingRate) => void
  onBack: () => void
  onSubmit: () => void
}

const formatAddress = (addr: Address) =>
  [addr.line1, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ')

export const ConfirmStep = (props: ConfirmStepProps) => {
  const {
    rates, ratesError, selectedRate, selectedProvider,
    origin, destination, packages, labelFormat,
    senderContact, receiverContact, targetPoint, c2cSendingMethod,
    isSubmitting, onRateSelect, onBack, onSubmit,
  } = props
  const t = useT()

  return (
    <section className="space-y-6">
      {ratesError ? (
        <div className="space-y-3">
          <ErrorMessage label={ratesError} />
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            {t('shipping_carriers.create.action.editConfiguration', 'Edit configuration')}
          </Button>
        </div>
      ) : null}

      {rates.length === 0 && !ratesError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('shipping_carriers.create.noRates', 'No rates available for this route and package configuration.')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.selectRate', 'Select service')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rates.map((rate) => {
                const isSelected = selectedRate?.serviceCode === rate.serviceCode
                return (
                  <button
                    key={rate.serviceCode}
                    type="button"
                    className={`flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                    onClick={() => onRateSelect(rate)}
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{rate.serviceName}</p>
                        <p className="text-xs text-muted-foreground">{rate.serviceCode}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {rate.estimatedDays !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          {t('shipping_carriers.create.estimatedDays', '{days} day(s)', { days: rate.estimatedDays })}
                        </span>
                      ) : null}
                      <Badge variant="secondary">
                        {rate.amount.toFixed(2)} {rate.currencyCode}
                      </Badge>
                      {isSelected ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('shipping_carriers.create.section.summary', 'Summary')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipping_carriers.create.summary.carrier', 'Carrier')}
              </dt>
              <dd className="mt-0.5 capitalize">{selectedProvider.replace(/_/g, ' ')}</dd>
            </div>
            {selectedRate ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('shipping_carriers.create.summary.service', 'Service')}
                </dt>
                <dd className="mt-0.5">{selectedRate.serviceName}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipping_carriers.create.summary.from', 'From')}
              </dt>
              <dd className="mt-0.5">{formatAddress(origin)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipping_carriers.create.summary.to', 'To')}
              </dt>
              <dd className="mt-0.5">{formatAddress(destination)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipping_carriers.create.summary.packages', 'Packages')}
              </dt>
              <dd className="mt-0.5">{packages.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('shipping_carriers.create.summary.labelFormat', 'Label format')}
              </dt>
              <dd className="mt-0.5 uppercase">{labelFormat}</dd>
            </div>
            {(senderContact.phone || senderContact.email) ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('shipping_carriers.create.summary.senderContact', 'Sender contact')}
                </dt>
                <dd className="mt-0.5">
                  {[senderContact.phone, senderContact.email].filter(Boolean).join(' / ')}
                </dd>
              </div>
            ) : null}
            {(receiverContact.phone || receiverContact.email) ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('shipping_carriers.create.summary.receiverContact', 'Receiver contact')}
                </dt>
                <dd className="mt-0.5">
                  {[receiverContact.phone, receiverContact.email].filter(Boolean).join(' / ')}
                </dd>
              </div>
            ) : null}
            {targetPoint ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('shipping_carriers.create.summary.targetPoint', 'Locker point')}
                </dt>
                <dd className="mt-0.5">{targetPoint}</dd>
              </div>
            ) : null}
            {c2cSendingMethod ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('shipping_carriers.create.summary.c2cSendingMethod', 'C2C sending method')}
                </dt>
                <dd className="mt-0.5">{c2cSendingMethod}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          {t('shipping_carriers.create.back', 'Back')}
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!selectedRate || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              {t('shipping_carriers.create.submitting', 'Creating shipment...')}
            </>
          ) : (
            t('shipping_carriers.create.submit', 'Create shipment')
          )}
        </Button>
      </div>
    </section>
  )
}
