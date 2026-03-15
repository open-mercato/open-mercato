"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AddressFields } from './AddressFields'
import { PackageEditor } from './PackageEditor'
import type { Address, PackageDimension, LabelFormat, ContactInfo } from '../types'

export type ConfigureStepProps = {
  origin: Address
  destination: Address
  packages: PackageDimension[]
  labelFormat: LabelFormat
  senderContact: ContactInfo
  receiverContact: ContactInfo
  targetPoint: string
  isFetchingRates: boolean
  canProceed: boolean
  onOriginChange: (address: Address) => void
  onDestinationChange: (address: Address) => void
  onPackagesChange: (packages: PackageDimension[]) => void
  onLabelFormatChange: (format: LabelFormat) => void
  onSenderContactChange: (contact: ContactInfo) => void
  onReceiverContactChange: (contact: ContactInfo) => void
  onTargetPointChange: (point: string) => void
  onBack: () => void
  onNext: () => void
}

const LABEL_FORMATS: LabelFormat[] = ['pdf', 'zpl', 'png']

export const ConfigureStep = (props: ConfigureStepProps) => {
  const {
    origin, destination, packages, labelFormat,
    senderContact, receiverContact, targetPoint,
    isFetchingRates, canProceed,
    onOriginChange, onDestinationChange, onPackagesChange, onLabelFormatChange,
    onSenderContactChange, onReceiverContactChange, onTargetPointChange,
    onBack, onNext,
  } = props
  const t = useT()

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
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  type="tel"
                  value={senderContact.phone}
                  onChange={(e) => onSenderContactChange({ ...senderContact, phone: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. 500000000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.email', 'Email')}
                </label>
                <input
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  type="email"
                  value={senderContact.email}
                  onChange={(e) => onSenderContactChange({ ...senderContact, email: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. sender@example.com"
                />
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
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  type="tel"
                  value={receiverContact.phone}
                  onChange={(e) => onReceiverContactChange({ ...receiverContact, phone: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. 500000000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('shipping_carriers.create.field.email', 'Email')}
                </label>
                <input
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  type="email"
                  value={receiverContact.email}
                  onChange={(e) => onReceiverContactChange({ ...receiverContact, email: e.target.value })}
                  disabled={isFetchingRates}
                  placeholder="e.g. receiver@example.com"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('shipping_carriers.create.section.lockerPoint', 'Locker point')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('shipping_carriers.create.field.targetPoint', 'Locker point ID (required for locker services)')}
            </label>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={targetPoint}
              onChange={(e) => onTargetPointChange(e.target.value)}
              disabled={isFetchingRates}
              placeholder="e.g. KRA010"
            />
          </div>
        </CardContent>
      </Card>

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
