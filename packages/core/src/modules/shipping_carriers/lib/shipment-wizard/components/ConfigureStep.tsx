"use client"

import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AddressFields } from './AddressFields'
import { PackageEditor } from './PackageEditor'
import type { Address, PackageDimension, LabelFormat } from '../types'

export type ConfigureStepProps = {
  origin: Address
  destination: Address
  packages: PackageDimension[]
  labelFormat: LabelFormat
  isFetchingRates: boolean
  canProceed: boolean
  onOriginChange: (address: Address) => void
  onDestinationChange: (address: Address) => void
  onPackagesChange: (packages: PackageDimension[]) => void
  onLabelFormatChange: (format: LabelFormat) => void
  onBack: () => void
  onNext: () => void
}

const LABEL_FORMATS: LabelFormat[] = ['pdf', 'zpl', 'png']

export const ConfigureStep = (props: ConfigureStepProps) => {
  const {
    origin, destination, packages, labelFormat,
    isFetchingRates, canProceed,
    onOriginChange, onDestinationChange, onPackagesChange, onLabelFormatChange,
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
