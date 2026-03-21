"use client"

import { match } from 'ts-pattern'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WizardNav } from '../../../lib/shipment-wizard/components/WizardNav'
import { ProviderStep } from '../../../lib/shipment-wizard/components/ProviderStep'
import { ConfigureStep } from '../../../lib/shipment-wizard/components/ConfigureStep'
import { ConfirmStep } from '../../../lib/shipment-wizard/components/ConfirmStep'
import { useShipmentWizard } from '../../../lib/shipment-wizard/hooks/useShipmentWizard'

const CreateCarrierShipmentPage = () => {
  const t = useT()
  const wizard = useShipmentWizard()

  return (
    <Page>
      <PageBody>
        <FormHeader
          backHref={wizard.backHref}
          title={t('shipping_carriers.create.title', 'Create carrier shipment')}
        />

        <WizardNav step={wizard.step} onNavigate={wizard.goToStep} />

        {match(wizard.step)
          .with('provider', () => (
            <ProviderStep
              isLoading={wizard.isLoadingProviders}
              error={wizard.providerError}
              providers={wizard.providers}
              onSelect={wizard.handleProviderSelect}
            />
          ))
          .with('configure', () => (
            <ConfigureStep
              origin={wizard.origin}
              destination={wizard.destination}
              packages={wizard.packages}
              labelFormat={wizard.labelFormat}
              senderContact={wizard.senderContact}
              receiverContact={wizard.receiverContact}
              targetPoint={wizard.targetPoint}
              c2cSendingMethod={wizard.c2cSendingMethod}
              isFetchingRates={wizard.isFetchingRates}
              canProceed={wizard.canProceedFromConfigure}
              senderContactErrors={wizard.senderContactErrors}
              receiverContactErrors={wizard.receiverContactErrors}
              dropOffPointQuery={wizard.dropOffPointQuery}
              dropOffPoints={wizard.dropOffPoints}
              isFetchingDropOffPoints={wizard.isFetchingDropOffPoints}
              dropOffPointsError={wizard.dropOffPointsError}
              onOriginChange={wizard.setOrigin}
              onDestinationChange={wizard.setDestination}
              onPackagesChange={wizard.setPackages}
              onLabelFormatChange={wizard.setLabelFormat}
              onSenderContactChange={wizard.setSenderContact}
              onReceiverContactChange={wizard.setReceiverContact}
              onTargetPointChange={wizard.setTargetPoint}
              onC2cSendingMethodChange={wizard.setC2cSendingMethod}
              onSearchDropOffPoints={wizard.searchDropOffPoints}
              onBack={() => wizard.goToStep('provider')}
              onNext={wizard.handleConfigureNext}
            />
          ))
          .with('confirm', () => (
            <ConfirmStep
              rates={wizard.rates}
              ratesError={wizard.ratesError}
              selectedRate={wizard.selectedRate}
              selectedProvider={wizard.selectedProvider ?? ''}
              origin={wizard.origin}
              destination={wizard.destination}
              packages={wizard.packages}
              labelFormat={wizard.labelFormat}
              senderContact={wizard.senderContact}
              receiverContact={wizard.receiverContact}
              targetPoint={wizard.targetPoint}
              c2cSendingMethod={wizard.c2cSendingMethod}
              isSubmitting={wizard.isSubmitting}
              onRateSelect={wizard.setSelectedRate}
              onBack={() => wizard.goToStep('configure')}
              onSubmit={wizard.handleSubmit}
            />
          ))
          .exhaustive()}
      </PageBody>
    </Page>
  )
}

export default CreateCarrierShipmentPage
