"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AddressFields } from './AddressFields'
import { PackageEditor } from './PackageEditor'
import type { Address, PackageDimension, LabelFormat, ContactInfo, DropOffPoint } from '../types'

export type ConfigureStepProps = {
  origin: Address
  destination: Address
  packages: PackageDimension[]
  labelFormat: LabelFormat
  senderContact: ContactInfo
  receiverContact: ContactInfo
  targetPoint: string
  c2cSendingMethod: string
  isFetchingRates: boolean
  canProceed: boolean
  senderContactErrors: { email: string | null; phone: string | null }
  receiverContactErrors: { email: string | null; phone: string | null }
  dropOffPointQuery: string
  dropOffPoints: DropOffPoint[]
  isFetchingDropOffPoints: boolean
  dropOffPointsError: string | null
  onOriginChange: (address: Address) => void
  onDestinationChange: (address: Address) => void
  onPackagesChange: (packages: PackageDimension[]) => void
  onLabelFormatChange: (format: LabelFormat) => void
  onSenderContactChange: (contact: ContactInfo) => void
  onReceiverContactChange: (contact: ContactInfo) => void
  onTargetPointChange: (point: string) => void
  onC2cSendingMethodChange: (method: string) => void
  onSearchDropOffPoints: (query: string) => void
  onBack: () => void
  onNext: () => void
}

const LABEL_FORMATS: LabelFormat[] = ['pdf', 'zpl', 'png']

export const ConfigureStep = (props: ConfigureStepProps) => {
  const {
    origin, destination, packages, labelFormat,
    senderContact, receiverContact, targetPoint, c2cSendingMethod,
    isFetchingRates, canProceed,
    senderContactErrors, receiverContactErrors,
    dropOffPointQuery, dropOffPoints, isFetchingDropOffPoints, dropOffPointsError,
    onOriginChange, onDestinationChange, onPackagesChange, onLabelFormatChange,
    onSenderContactChange, onReceiverContactChange, onTargetPointChange, onC2cSendingMethodChange,
    onSearchDropOffPoints,
    onBack, onNext,
  } = props
  const t = useT()
  const [searchInput, setSearchInput] = React.useState(dropOffPointQuery)

  return (
    <section className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.origin', 'Origin address')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AddressFields prefix="origin" address={origin} onChange={onOriginChange} disabled={isFetchingRates} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.destination', 'Destination address')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AddressFields prefix="dest" address={destination} onChange={onDestinationChange} disabled={isFetchingRates} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('shipping_carriers.create.section.packages', 'Packages')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PackageEditor packages={packages} onChange={onPackagesChange} disabled={isFetchingRates} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.senderContact', 'Sender contact')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.phone', 'Phone')}
                </label>
                <input
                  className={`w-full rounded border bg-background px-2 py-1.5 text-sm ${senderContactErrors.phone ? 'border-destructive' : ''}`}
                  type="tel"
                  value={senderContact.phone}
                  onChange={(e) => onSenderContactChange({ ...senderContact, phone: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. 500000000"
                />
                {senderContactErrors.phone ? (
                  <p className="text-xs text-destructive">{senderContactErrors.phone}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.email', 'Email')}
                </label>
                <input
                  className={`w-full rounded border bg-background px-2 py-1.5 text-sm ${senderContactErrors.email ? 'border-destructive' : ''}`}
                  type="email"
                  value={senderContact.email}
                  onChange={(e) => onSenderContactChange({ ...senderContact, email: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. sender@example.com"
                />
                {senderContactErrors.email ? (
                  <p className="text-xs text-destructive">{senderContactErrors.email}</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.receiverContact', 'Receiver contact')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.phone', 'Phone')}
                </label>
                <input
                  className={`w-full rounded border bg-background px-2 py-1.5 text-sm ${receiverContactErrors.phone ? 'border-destructive' : ''}`}
                  type="tel"
                  value={receiverContact.phone}
                  onChange={(e) => onReceiverContactChange({ ...receiverContact, phone: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. 500000000"
                />
                {receiverContactErrors.phone ? (
                  <p className="text-xs text-destructive">{receiverContactErrors.phone}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.email', 'Email')}
                </label>
                <input
                  className={`w-full rounded border bg-background px-2 py-1.5 text-sm ${receiverContactErrors.email ? 'border-destructive' : ''}`}
                  type="email"
                  value={receiverContact.email}
                  onChange={(e) => onReceiverContactChange({ ...receiverContact, email: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. receiver@example.com"
                />
                {receiverContactErrors.email ? (
                  <p className="text-xs text-destructive">{receiverContactErrors.email}</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('shipping_carriers.create.section.c2cSendingMethod', 'C2C sending method')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('shipping_carriers.create.field.c2cSendingMethod', 'Sending method (applies to courier_c2c service only)')}
            </label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={c2cSendingMethod}
              onChange={(e) => onC2cSendingMethodChange(e.target.value)}
              disabled={isFetchingRates}
            >
              <option value="">{t('shipping_carriers.create.c2cSendingMethod.default', 'Dispatch order (default)')}</option>
              <option value="parcel_locker">{t('shipping_carriers.create.c2cSendingMethod.parcel_locker', 'Parcel locker')}</option>
              <option value="pop">{t('shipping_carriers.create.c2cSendingMethod.pop', 'POP (parcel pickup point)')}</option>
              <option value="any_point">{t('shipping_carriers.create.c2cSendingMethod.any_point', 'Any point')}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {(c2cSendingMethod === 'parcel_locker' || c2cSendingMethod === 'pop') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('shipping_carriers.create.section.dropOffPoint', 'Drop-off / locker point')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {targetPoint && (
              <div className="rounded border border-primary bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium text-xs text-muted-foreground mr-2">
                  {t('shipping_carriers.create.field.selectedPoint', 'Selected:')}
                </span>
                <span className="font-mono font-medium">{targetPoint}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-auto py-0 text-xs"
                  onClick={() => onTargetPointChange('')}
                  disabled={isFetchingRates}
                >
                  {t('shipping_carriers.create.action.clearPoint', 'Clear')}
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSearchDropOffPoints(searchInput)
                  }
                }}
                disabled={isFetchingRates}
                placeholder={t('shipping_carriers.create.field.dropOffSearch', 'Postal code (e.g. 30-624) or point name (e.g. KRA012)')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSearchDropOffPoints(searchInput)}
                disabled={isFetchingRates || isFetchingDropOffPoints || searchInput.trim().length === 0}
              >
                {isFetchingDropOffPoints ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  t('shipping_carriers.create.action.searchPoints', 'Search')
                )}
              </Button>
            </div>

            {dropOffPointsError && (
              <p className="text-xs text-destructive">{dropOffPointsError}</p>
            )}

            {dropOffPoints.length > 0 && (
              <ul className="max-h-60 overflow-y-auto divide-y rounded border text-sm">
                {dropOffPoints.map((point) => (
                  <li key={point.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left hover:bg-accent ${targetPoint === point.id ? 'bg-primary/5 font-medium' : ''}`}
                      onClick={() => onTargetPointChange(point.id)}
                      disabled={isFetchingRates}
                    >
                      <span className="font-mono mr-2">{point.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {[point.street, point.city, point.postalCode].filter(Boolean).join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!isFetchingDropOffPoints && dropOffPoints.length === 0 && dropOffPointQuery && !dropOffPointsError && (
              <p className="text-xs text-muted-foreground">
                {t('shipping_carriers.create.dropOffPoints.noResults', 'No drop-off points found for this search.')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('shipping_carriers.create.section.labelFormat', 'Label format')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {LABEL_FORMATS.map((fmt) => (
              <Button
                key={fmt}
                type="button"
                variant={labelFormat === fmt ? 'default' : 'outline'}
                size="sm"
                onClick={() => onLabelFormatChange(fmt)}
                disabled={isFetchingRates}
              >
                {fmt.toUpperCase()}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={isFetchingRates}>
          {t('shipping_carriers.create.back', 'Back')}
        </Button>
        <Button type="button" onClick={onNext} disabled={!canProceed || isFetchingRates}>
          {isFetchingRates ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              {t('shipping_carriers.create.fetchingRates', 'Fetching rates...')}
            </>
          ) : (
            t('shipping_carriers.create.getQuotes', 'Get quotes')
          )}
        </Button>
      </div>
    </section>
  )
}

