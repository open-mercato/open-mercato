import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  fetchProviders,
  fetchOrderAddresses,
  fetchRates,
  createShipment,
  fetchDropOffPoints,
} from './shipmentApi'
import type {
  WizardStep,
  Provider,
  Address,
  PackageDimension,
  ShippingRate,
  LabelFormat,
  DocumentAddress,
  ContactInfo,
  DropOffPoint,
} from '../types'

const EMPTY_ADDRESS: Address = { countryCode: '', postalCode: '', city: '', line1: '' }
const EMPTY_CONTACT: ContactInfo = { phone: '', email: '' }
const DEFAULT_PACKAGE: PackageDimension = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }

const buildAddressFromDocument = (doc: DocumentAddress): Address => ({
  countryCode: doc.country ?? '',
  postalCode: doc.postal_code ?? '',
  city: doc.city ?? '',
  line1: doc.address_line1,
  line2: doc.address_line2 ?? undefined,
})

const isAddressValid = (addr: Address) =>
  addr.countryCode.length >= 2 &&
  addr.postalCode.length > 0 &&
  addr.city.length > 0 &&
  addr.line1.length > 0

const isPackageValid = (pkg: PackageDimension) =>
  pkg.weightKg > 0 && pkg.lengthCm > 0 && pkg.widthCm > 0 && pkg.heightCm > 0

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^[+\d][\d\s\-().]{6,}$/

const isEmailValid = (email: string) => email === '' || EMAIL_REGEX.test(email)
const isPhoneValid = (phone: string) => phone === '' || PHONE_REGEX.test(phone)

export type ShipmentWizard = {
  step: WizardStep
  backHref: string

  // Provider step
  providers: Provider[]
  isLoadingProviders: boolean
  providerError: string | null
  selectedProvider: string | null

  // Configure step
  origin: Address
  destination: Address
  packages: PackageDimension[]
  labelFormat: LabelFormat
  senderContact: ContactInfo
  receiverContact: ContactInfo
  targetPoint: string
  c2cSendingMethod: string
  isFetchingRates: boolean
  canProceedFromConfigure: boolean
  senderContactErrors: { email: string | null; phone: string | null }
  receiverContactErrors: { email: string | null; phone: string | null }

  // Drop-off point search
  dropOffPointQuery: string
  dropOffPoints: DropOffPoint[]
  isFetchingDropOffPoints: boolean
  dropOffPointsError: string | null

  // Confirm step
  rates: ShippingRate[]
  ratesError: string | null
  selectedRate: ShippingRate | null
  isSubmitting: boolean

  // Actions
  goToStep: (step: WizardStep) => void
  handleProviderSelect: (providerKey: string) => void
  handleConfigureNext: () => void
  handleSubmit: () => void
  setOrigin: (address: Address) => void
  setDestination: (address: Address) => void
  setPackages: (packages: PackageDimension[]) => void
  setLabelFormat: (format: LabelFormat) => void
  setSenderContact: (contact: ContactInfo) => void
  setReceiverContact: (contact: ContactInfo) => void
  setTargetPoint: (point: string) => void
  setC2cSendingMethod: (method: string) => void
  setSelectedRate: (rate: ShippingRate) => void
  searchDropOffPoints: (query: string) => void
}

export const useShipmentWizard = (): ShipmentWizard => {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams?.get('orderId') ?? null

  const [step, setStep] = React.useState<WizardStep>('provider')
  const [providers, setProviders] = React.useState<Provider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = React.useState(true)
  const [providerError, setProviderError] = React.useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = React.useState<string | null>(null)

  const [origin, setOrigin] = React.useState<Address>(EMPTY_ADDRESS)
  const [destination, setDestination] = React.useState<Address>(EMPTY_ADDRESS)
  const [packages, setPackages] = React.useState<PackageDimension[]>([DEFAULT_PACKAGE])
  const [labelFormat, setLabelFormat] = React.useState<LabelFormat>('pdf')
  const [senderContact, setSenderContact] = React.useState<ContactInfo>(EMPTY_CONTACT)
  const [receiverContact, setReceiverContact] = React.useState<ContactInfo>(EMPTY_CONTACT)
  const [targetPoint, setTargetPoint] = React.useState<string>('')
  const [c2cSendingMethod, setC2cSendingMethod] = React.useState<string>('')

  const [dropOffPointQuery, setDropOffPointQuery] = React.useState<string>('')
  const [dropOffPoints, setDropOffPoints] = React.useState<DropOffPoint[]>([])
  const [isFetchingDropOffPoints, setIsFetchingDropOffPoints] = React.useState(false)
  const [dropOffPointsError, setDropOffPointsError] = React.useState<string | null>(null)

  const [rates, setRates] = React.useState<ShippingRate[]>([])
  const [isFetchingRates, setIsFetchingRates] = React.useState(false)
  const [ratesError, setRatesError] = React.useState<string | null>(null)
  const [selectedRate, setSelectedRate] = React.useState<ShippingRate | null>(null)

  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const backHref = orderId ? `/backend/sales/orders/${orderId}` : '/backend/sales/orders'

  React.useEffect(() => {
    const loadProviders = async () => {
      setIsLoadingProviders(true)
      setProviderError(null)
      const result = await fetchProviders()
      if (result.ok) {
        setProviders(result.providers)
      } else {
        setProviderError(t('shipping_carriers.create.error.loadProviders', result.error))
      }
      setIsLoadingProviders(false)
    }
    void loadProviders()
  }, [t])

  React.useEffect(() => {
    if (!orderId) return
    const prefillAddresses = async () => {
      const result = await fetchOrderAddresses(orderId)
      if (!result.ok) return
      const items = result.items
      const shippingAddr =
        items.find((item) => item.purpose === 'shipping') ??
        items.find((item) => item.purpose === 'delivery') ??
        items[0]
      if (shippingAddr) setDestination(buildAddressFromDocument(shippingAddr))
    }
    void prefillAddresses()
  }, [orderId])

  const loadRates = async () => {
    if (!selectedProvider) return
    setIsFetchingRates(true)
    setRatesError(null)
    setRates([])
    setSelectedRate(null)
    const result = await fetchRates({
      providerKey: selectedProvider,
      origin,
      destination,
      packages,
      ...(receiverContact.phone ? { receiverPhone: receiverContact.phone } : {}),
      ...(receiverContact.email ? { receiverEmail: receiverContact.email } : {}),
    })
    if (result.ok) {
      setRates(result.rates)
      if (result.rates.length > 0) setSelectedRate(result.rates[0])
    } else {
      setRatesError(t('shipping_carriers.create.error.fetchRates', result.error))
    }
    setIsFetchingRates(false)
  }

  const handleSubmit = async () => {
    if (!selectedProvider || !selectedRate || !orderId) return
    setIsSubmitting(true)
    const result = await createShipment({
      providerKey: selectedProvider,
      orderId,
      origin,
      destination,
      packages,
      serviceCode: selectedRate.serviceCode,
      labelFormat,
      ...(senderContact.phone ? { senderPhone: senderContact.phone } : {}),
      ...(senderContact.email ? { senderEmail: senderContact.email } : {}),
      ...(receiverContact.phone ? { receiverPhone: receiverContact.phone } : {}),
      ...(receiverContact.email ? { receiverEmail: receiverContact.email } : {}),
      ...(targetPoint ? { targetPoint } : {}),
      ...(c2cSendingMethod ? { c2cSendingMethod } : {}),
    })
    setIsSubmitting(false)
    if (result.ok) {
      flash(t('shipping_carriers.create.success', 'Shipment created successfully.'), 'success')
      router.push(backHref)
    } else {
      flash(t('shipping_carriers.create.error.create', result.error), 'error')
    }
  }

  const goToStep = (next: WizardStep) => setStep(next)

  const handleProviderSelect = (providerKey: string) => {
    setSelectedProvider(providerKey)
    goToStep('configure')
  }

  const handleConfigureNext = () => {
    void loadRates().then(() => goToStep('confirm'))
  }

  const searchDropOffPoints = async (query: string) => {
    if (!selectedProvider) return
    setDropOffPointQuery(query)
    setIsFetchingDropOffPoints(true)
    setDropOffPointsError(null)
    const isPostCode = /^\d{2}-?\d{3}$/.test(query.trim())
    const resolvedType = c2cSendingMethod === 'pop' ? 'pop' : 'parcel_locker'
    const result = await fetchDropOffPoints({
      providerKey: selectedProvider,
      ...(isPostCode ? { postCode: query.trim() } : { query: query.trim() }),
      type: resolvedType,
    })
    if (result.ok) {
      setDropOffPoints(result.points)
    } else {
      setDropOffPointsError(t('shipping_carriers.create.error.fetchDropOffPoints', result.error))
      setDropOffPoints([])
    }
    setIsFetchingDropOffPoints(false)
  }

  const canProceedFromConfigure =
    isAddressValid(origin) &&
    isAddressValid(destination) &&
    packages.length > 0 &&
    packages.every(isPackageValid) &&
    isEmailValid(senderContact.email) &&
    isPhoneValid(senderContact.phone) &&
    isEmailValid(receiverContact.email) &&
    isPhoneValid(receiverContact.phone)

  const senderContactErrors = {
    email: !isEmailValid(senderContact.email) ? t('shipping_carriers.create.error.invalidEmail', 'Invalid email address.') : null,
    phone: !isPhoneValid(senderContact.phone) ? t('shipping_carriers.create.error.invalidPhone', 'Invalid phone number.') : null,
  }
  const receiverContactErrors = {
    email: !isEmailValid(receiverContact.email) ? t('shipping_carriers.create.error.invalidEmail', 'Invalid email address.') : null,
    phone: !isPhoneValid(receiverContact.phone) ? t('shipping_carriers.create.error.invalidPhone', 'Invalid phone number.') : null,
  }

  return {
    step,
    backHref,
    providers,
    isLoadingProviders,
    providerError,
    selectedProvider,
    origin,
    destination,
    packages,
    labelFormat,
    senderContact,
    receiverContact,
    targetPoint,
    c2cSendingMethod,
    isFetchingRates,
    canProceedFromConfigure,
    senderContactErrors,
    receiverContactErrors,
    dropOffPointQuery,
    dropOffPoints,
    isFetchingDropOffPoints,
    dropOffPointsError,
    rates,
    ratesError,
    selectedRate,
    isSubmitting,
    goToStep,
    handleProviderSelect,
    handleConfigureNext,
    handleSubmit: () => void handleSubmit(),
    setOrigin,
    setDestination,
    setPackages,
    setLabelFormat,
    setSenderContact,
    setReceiverContact,
    setTargetPoint,
    setC2cSendingMethod,
    setSelectedRate,
    searchDropOffPoints: (query: string) => void searchDropOffPoints(query),
  }
}
