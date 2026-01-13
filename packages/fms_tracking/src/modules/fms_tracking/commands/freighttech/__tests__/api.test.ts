jest.mock('../settings', () => ({
  loadFreighttechTrackingSettings: jest.fn(),
}))

jest.mock('../../../lib/webhookToken', () => ({
  encodeWebhookToken: jest.fn(),
}))

import { EntityManager } from '@mikro-orm/core'
import { FreighttechRegisterSubscription } from '../api'
import { loadFreighttechTrackingSettings } from '../settings'
import { encodeWebhookToken } from '../../../lib/webhookToken'

// Mock global fetch
global.fetch = jest.fn()

describe('freighttech_api', () => {
  let mockEm: jest.Mocked<EntityManager>
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock EntityManager
    mockEm = {} as jest.Mocked<EntityManager>

    // Spy on console.warn
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

    // Set default environment variables
    process.env.APP_URL = 'https://test-app.example.com'

    // Mock encodeWebhookToken to return a predictable token
    ;(encodeWebhookToken as jest.Mock).mockReturnValue('mock-token-abc123')
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    delete process.env.APP_URL
  })

  describe('RegisterContainerSubscription', () => {
    const mockParams = {
      organizationId: 'org-123',
      tenantId: 'tenant-456',
      carrierCode: 'MAEU',
      bookingNumber: 'BOOK123456',
      containerId: 'CONT789012',
    }

    const mockApiKey = 'test-api-key-xyz'
    const mockApiBaseUrl = 'https://test-api.freighttech.org/api'

    const mockSuccessResponse = {
      message: 'Reference created successfully',
      reference: {
        id: 'ref-123',
        container_id: 'CONT789012',
        bill_of_lading: 'BOOK123456',
        carrier_code: 'MAEU',
        booking_number: 'MAEU325537156',
        carrier_id: 'carrier-1',
        callback_url: 'https://test-app.example.com/api/fms_tracking/webhook/freighttech?token=mock-token-abc123',
        organization_id: 'org-ext-123',
        parent_reference_id: null,
        latest_update_id: 'update-1',
        active: true,
        auto_unsubscribed: false,
        deactivate_reason: '',
        last_update_status: 'success',
        created_at: '2025-12-15T14:00:00Z',
        updated_at: '2025-12-15T14:00:00Z',
        last_update_attempted_at: '2025-12-15T14:00:00Z',
        retry_count: 0,
        organization: {
          id: 'org-ext-123',
          name: 'Test Organization',
          active: true,
          process_frequency_minutes: 60,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        carrier: {
          id: 'carrier-1',
          name: 'Maersk',
          code: 'MAEU',
          enabled: true,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      },
    }

    it('successfully registers a container subscription with all parameters', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockSuccessResponse,
      })

      const result = await FreighttechRegisterSubscription(mockEm, mockParams)

      // Verify settings were loaded with correct params
      expect(loadFreighttechTrackingSettings).toHaveBeenCalledWith(mockEm, {
        organizationId: mockParams.organizationId,
        tenantId: mockParams.tenantId,
      })

      // Verify encodeWebhookToken was called with correct params
      expect(encodeWebhookToken).toHaveBeenCalledWith({
        organizationId: mockParams.organizationId,
        tenantId: mockParams.tenantId,
      })

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiBaseUrl}/v1/references`,
        {
          method: 'POST',
          headers: {
            'X-Api-Key': mockApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            carrier_code: mockParams.carrierCode,
            booking_number: mockParams.bookingNumber,
            container_id: mockParams.containerId,
            callback_url: 'https://test-app.example.com/api/fms_tracking/webhook/freighttech?token=mock-token-abc123',
          }),
          signal: expect.any(AbortSignal),
        }
      )

      // Verify correct response was returned
      expect(result).toEqual(mockSuccessResponse)

      // Verify no warning was logged
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('works with only booking number (no container ID)', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      })

      const paramsWithoutContainerId = {
        ...mockParams,
        containerId: undefined,
      }

      await FreighttechRegisterSubscription(mockEm, paramsWithoutContainerId)

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiBaseUrl}/v1/references`,
        expect.objectContaining({
          body: JSON.stringify({
            carrier_code: mockParams.carrierCode,
            booking_number: mockParams.bookingNumber,
            callback_url: 'https://test-app.example.com/api/fms_tracking/webhook/freighttech?token=mock-token-abc123',
          }),
        })
      )
    })

    it('works with only container ID (no booking number)', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      })

      const paramsWithoutBookingNumber = {
        ...mockParams,
        bookingNumber: undefined,
      }

      await FreighttechRegisterSubscription(mockEm, paramsWithoutBookingNumber)

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiBaseUrl}/v1/references`,
        expect.objectContaining({
          body: JSON.stringify({
            carrier_code: mockParams.carrierCode,
            container_id: mockParams.containerId,
            callback_url: 'https://test-app.example.com/api/fms_tracking/webhook/freighttech?token=mock-token-abc123',
          }),
        })
      )
    })

    it('throws error when missing APP_URL', async () => {
      delete process.env.APP_URL

      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        'fms_tracking.api] missing APP_URL'
      )

      // Fetch should not be called if APP_URL is missing
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('throws error when missing apiKey and apiBaseUrl', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue(null)

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        '[fms_tracking.api] missing apiKey and/or apiBaseUrl'
      )

      // Fetch should not be called if settings are missing
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('throws error when missing only apiKey', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiBaseUrl: mockApiBaseUrl,
        apiKey: undefined,
      })

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        '[fms_tracking.api] missing apiKey and/or apiBaseUrl'
      )

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('throws error when missing only apiBaseUrl', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: undefined,
      })

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        '[fms_tracking.api] missing apiKey and/or apiBaseUrl'
      )

      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('throws error and logs warning when response status is not ok (400)', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      const errorData = {
        error: 'Invalid carrier code',
      }

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => errorData,
      })

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        'fms_tracking.api] HTTP error! status: 400'
      )

      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[fms_tracking.api] external API call: 400 Bad Request',
        { error: errorData }
      )
    })

    it('throws error and logs warning for 500 server error', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      const errorData = {
        error: 'Database connection failed',
      }

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => errorData,
      })

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow(
        'fms_tracking.api] HTTP error! status: 500'
      )

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[fms_tracking.api] external API call: 500 Internal Server Error',
        { error: errorData }
      )
    })

    it('throws error when fetch request fails (network error)', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      const networkError = new Error('Network error')
      ;(global.fetch as jest.Mock).mockRejectedValue(networkError)

      await expect(FreighttechRegisterSubscription(mockEm, mockParams)).rejects.toThrow('Network error')
    })

    it('includes callback URL with APP_URL environment variable and token', async () => {
      process.env.APP_URL = 'https://custom-domain.com'

      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      })

      await FreighttechRegisterSubscription(mockEm, mockParams)

      expect(encodeWebhookToken).toHaveBeenCalledWith({
        organizationId: mockParams.organizationId,
        tenantId: mockParams.tenantId,
      })

      expect(global.fetch).toHaveBeenCalledWith(
        `${mockApiBaseUrl}/v1/references`,
        expect.objectContaining({
          body: JSON.stringify({
            carrier_code: mockParams.carrierCode,
            booking_number: mockParams.bookingNumber,
            container_id: mockParams.containerId,
            callback_url: 'https://custom-domain.com/api/fms_tracking/webhook/freighttech?token=mock-token-abc123',
          }),
        })
      )
    })

    it('uses AbortSignal.timeout for request timeout', async () => {
      ;(loadFreighttechTrackingSettings as jest.Mock).mockResolvedValue({
        apiKey: mockApiKey,
        apiBaseUrl: mockApiBaseUrl,
      })

      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      })

      await FreighttechRegisterSubscription(mockEm, mockParams)

      // Verify that fetch was called with an AbortSignal
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal)
    })
  })
})
