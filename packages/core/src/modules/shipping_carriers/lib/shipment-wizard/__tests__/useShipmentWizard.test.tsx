/**
 * @jest-environment jsdom
 */
import Chance from 'chance'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useShipmentWizard } from '../hooks/useShipmentWizard'

const chance = new Chance()

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: jest.fn(),
}))

jest.mock('../hooks/shipmentApi', () => ({
  fetchProviders: jest.fn(),
  fetchOrderAddresses: jest.fn(),
  fetchRates: jest.fn(),
  createShipment: jest.fn(),
}))

import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  fetchProviders,
  fetchOrderAddresses,
  fetchRates,
  createShipment,
} from '../hooks/shipmentApi'

const mockFlash = flash as jest.MockedFunction<typeof flash>
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>
const mockUseT = useT as jest.MockedFunction<typeof useT>
const mockFetchProviders = fetchProviders as jest.MockedFunction<typeof fetchProviders>
const mockFetchOrderAddresses = fetchOrderAddresses as jest.MockedFunction<typeof fetchOrderAddresses>
const mockFetchRates = fetchRates as jest.MockedFunction<typeof fetchRates>
const mockCreateShipment = createShipment as jest.MockedFunction<typeof createShipment>

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeProvider = () => ({ providerKey: chance.word() })

const makeRate = () => ({
  serviceCode: chance.word(),
  serviceName: chance.sentence({ words: 3 }),
  amount: chance.floating({ min: 1, max: 100, fixed: 2 }),
  currencyCode: chance.currency().code,
})

const makeAddress = () => ({
  countryCode: chance.country(),
  postalCode: chance.zip(),
  city: chance.city(),
  line1: chance.address(),
})

const makeDocumentAddress = (purpose = 'shipping') => ({
  id: chance.guid(),
  purpose,
  address_line1: chance.address(),
  address_line2: chance.street(),
  city: chance.city(),
  postal_code: chance.zip(),
  country: chance.country(),
})

const setupBaseMocks = (orderId: string | null = null) => {
  const routerPush = jest.fn()
  mockUseRouter.mockReturnValue({ push: routerPush } as any)
  mockUseSearchParams.mockReturnValue({ get: (key: string) => (key === 'orderId' ? orderId : null) } as any)
  mockUseT.mockReturnValue(((_key: string, fallback: string) => fallback) as any)
  mockFetchProviders.mockResolvedValue({ ok: true, providers: [] })
  mockFetchOrderAddresses.mockResolvedValue({ ok: false })
  return { routerPush }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useShipmentWizard', () => {
  afterEach(() => jest.clearAllMocks())

  describe('initial state', () => {
    it('starts on the provider step', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      expect(result.current.step).toBe('provider')
    })

    it('starts with isLoadingProviders:true', async () => {
      setupBaseMocks()
      mockFetchProviders.mockReturnValue(new Promise(() => {})) // never resolves
      const { result } = renderHook(() => useShipmentWizard())
      expect(result.current.isLoadingProviders).toBe(true)
    })

    it('sets backHref to orders list when no orderId', async () => {
      setupBaseMocks(null)
      const { result } = renderHook(() => useShipmentWizard())
      expect(result.current.backHref).toBe('/backend/sales/orders')
    })

    it('sets backHref to order detail when orderId is present', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const { result } = renderHook(() => useShipmentWizard())
      expect(result.current.backHref).toBe(`/backend/sales/orders/${orderId}`)
    })
  })

  describe('provider loading on mount', () => {
    it('loads providers and sets them in state', async () => {
      setupBaseMocks()
      const providers = [makeProvider(), makeProvider()]
      mockFetchProviders.mockResolvedValue({ ok: true, providers })

      const { result } = renderHook(() => useShipmentWizard())

      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))
      expect(result.current.providers).toEqual(providers)
      expect(result.current.providerError).toBeNull()
    })

    it('sets providerError when fetchProviders fails', async () => {
      setupBaseMocks()
      const errorMessage = chance.sentence()
      mockFetchProviders.mockResolvedValue({ ok: false, error: errorMessage })

      const { result } = renderHook(() => useShipmentWizard())

      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))
      expect(result.current.providers).toEqual([])
      expect(result.current.providerError).toBe(errorMessage)
    })
  })

  describe('address prefill from order', () => {
    it('prefills destination from shipping address when orderId provided', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const shippingAddr = makeDocumentAddress('shipping')
      mockFetchOrderAddresses.mockResolvedValue({ ok: true, items: [shippingAddr] })

      const { result } = renderHook(() => useShipmentWizard())

      await waitFor(() => expect(mockFetchOrderAddresses).toHaveBeenCalledWith(orderId))
      await waitFor(() => expect(result.current.destination.city).toBe(shippingAddr.city))
    })

    it('falls back to delivery address when no shipping address', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const deliveryAddr = makeDocumentAddress('delivery')
      mockFetchOrderAddresses.mockResolvedValue({ ok: true, items: [deliveryAddr] })

      const { result } = renderHook(() => useShipmentWizard())

      await waitFor(() => expect(result.current.destination.city).toBe(deliveryAddr.city))
    })

    it('does not call fetchOrderAddresses when orderId is null', async () => {
      setupBaseMocks(null)

      renderHook(() => useShipmentWizard())

      await waitFor(() => expect(mockFetchProviders).toHaveBeenCalled())
      expect(mockFetchOrderAddresses).not.toHaveBeenCalled()
    })
  })

  describe('handleProviderSelect', () => {
    it('sets selectedProvider and advances to configure step', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      const providerKey = chance.word()
      act(() => result.current.handleProviderSelect(providerKey))

      expect(result.current.selectedProvider).toBe(providerKey)
      expect(result.current.step).toBe('configure')
    })
  })

  describe('handleConfigureNext', () => {
    it('fetches rates and advances to confirm step', async () => {
      setupBaseMocks()
      const rates = [makeRate()]
      mockFetchRates.mockResolvedValue({ ok: true, rates })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      const providerKey = chance.word()
      act(() => result.current.handleProviderSelect(providerKey))
      act(() => result.current.handleConfigureNext())

      await waitFor(() => expect(result.current.step).toBe('confirm'))
      expect(result.current.rates).toEqual(rates)
      expect(result.current.ratesError).toBeNull()
    })

    it('pre-selects the first rate', async () => {
      setupBaseMocks()
      const rates = [makeRate(), makeRate()]
      mockFetchRates.mockResolvedValue({ ok: true, rates })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.handleProviderSelect(chance.word()))
      act(() => result.current.handleConfigureNext())

      await waitFor(() => expect(result.current.selectedRate).toEqual(rates[0]))
    })

    it('sets ratesError when fetchRates fails', async () => {
      setupBaseMocks()
      const errorMessage = chance.sentence()
      mockFetchRates.mockResolvedValue({ ok: false, error: errorMessage })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.handleProviderSelect(chance.word()))
      act(() => result.current.handleConfigureNext())

      await waitFor(() => expect(result.current.step).toBe('confirm'))
      expect(result.current.ratesError).toBe(errorMessage)
    })
  })

  describe('handleSubmit', () => {
    const setupReadyToSubmit = async () => {
      const orderId = chance.guid()
      const { routerPush } = setupBaseMocks(orderId)
      const rate = makeRate()
      mockFetchRates.mockResolvedValue({ ok: true, rates: [rate] })
      mockCreateShipment.mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.handleProviderSelect(chance.word()))
      act(() => result.current.handleConfigureNext())
      await waitFor(() => expect(result.current.step).toBe('confirm'))

      return { result, routerPush, orderId, rate }
    }

    it('calls createShipment and navigates on success', async () => {
      const { result, routerPush, orderId } = await setupReadyToSubmit()

      act(() => result.current.handleSubmit())

      await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/backend/sales/orders/${orderId}`))
      expect(mockFlash).toHaveBeenCalledWith(expect.any(String), 'success')
    })

    it('flashes error and does not navigate on failure', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const errorMessage = chance.sentence()
      mockFetchRates.mockResolvedValue({ ok: true, rates: [makeRate()] })
      mockCreateShipment.mockResolvedValue({ ok: false, error: errorMessage })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.handleProviderSelect(chance.word()))
      act(() => result.current.handleConfigureNext())
      await waitFor(() => expect(result.current.step).toBe('confirm'))
      act(() => result.current.handleSubmit())

      await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(errorMessage, 'error'))
      const routerPush = mockUseRouter.mock.results[0].value.push
      expect(routerPush).not.toHaveBeenCalled()
    })

    it('does nothing when selectedProvider is missing', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.handleSubmit())

      await new Promise((r) => setTimeout(r, 20))
      expect(mockCreateShipment).not.toHaveBeenCalled()
    })
  })

  describe('contact fields', () => {
    it('initialises senderContact, receiverContact, and targetPoint to empty', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      expect(result.current.senderContact).toEqual({ phone: '', email: '' })
      expect(result.current.receiverContact).toEqual({ phone: '', email: '' })
      expect(result.current.targetPoint).toBe('')
    })

    it('setSenderContact updates senderContact', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.setSenderContact({ phone: '111', email: 'a@b.com' }))

      expect(result.current.senderContact).toEqual({ phone: '111', email: 'a@b.com' })
    })

    it('setReceiverContact updates receiverContact', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.setReceiverContact({ phone: '222', email: 'c@d.com' }))

      expect(result.current.receiverContact).toEqual({ phone: '222', email: 'c@d.com' })
    })

    it('setTargetPoint updates targetPoint', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => result.current.setTargetPoint('WAW100'))

      expect(result.current.targetPoint).toBe('WAW100')
    })

    it('passes receiverContact fields to fetchRates when non-empty', async () => {
      setupBaseMocks()
      mockFetchRates.mockResolvedValue({ ok: true, rates: [] })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => {
        result.current.setReceiverContact({ phone: '500000000', email: 'recv@example.com' })
        result.current.handleProviderSelect(chance.word())
      })
      act(() => result.current.handleConfigureNext())

      await waitFor(() => expect(mockFetchRates).toHaveBeenCalled())
      const callArgs = mockFetchRates.mock.calls[0][0]
      expect(callArgs.receiverPhone).toBe('500000000')
      expect(callArgs.receiverEmail).toBe('recv@example.com')
    })

    it('passes contact and targetPoint to createShipment when provided', async () => {
      const orderId = chance.guid()
      setupBaseMocks(orderId)
      const rate = makeRate()
      mockFetchRates.mockResolvedValue({ ok: true, rates: [rate] })
      mockCreateShipment.mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => {
        result.current.setSenderContact({ phone: '111', email: 'send@x.com' })
        result.current.setReceiverContact({ phone: '222', email: 'recv@x.com' })
        result.current.setTargetPoint('KRA010')
        result.current.handleProviderSelect(chance.word())
      })
      act(() => result.current.handleConfigureNext())
      await waitFor(() => expect(result.current.step).toBe('confirm'))
      act(() => result.current.handleSubmit())

      await waitFor(() => expect(mockCreateShipment).toHaveBeenCalled())
      const callArgs = mockCreateShipment.mock.calls[0][0]
      expect(callArgs.senderPhone).toBe('111')
      expect(callArgs.senderEmail).toBe('send@x.com')
      expect(callArgs.receiverPhone).toBe('222')
      expect(callArgs.receiverEmail).toBe('recv@x.com')
      expect(callArgs.targetPoint).toBe('KRA010')
    })
  })

  describe('canProceedFromConfigure', () => {
    it('is false with default empty addresses', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))
      expect(result.current.canProceedFromConfigure).toBe(false)
    })

    it('is true when both addresses and packages are valid', async () => {
      setupBaseMocks()
      const { result } = renderHook(() => useShipmentWizard())
      await waitFor(() => expect(result.current.isLoadingProviders).toBe(false))

      act(() => {
        result.current.setOrigin(makeAddress())
        result.current.setDestination(makeAddress())
      })

      expect(result.current.canProceedFromConfigure).toBe(true)
    })
  })
})
