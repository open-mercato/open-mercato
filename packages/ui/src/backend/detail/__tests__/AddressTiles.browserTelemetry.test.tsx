import * as React from 'react'
import { TextEncoder } from 'node:util'
import { act, screen, waitFor } from '@testing-library/react'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { BrowserTelemetry, type BrowserTelemetryConfig } from '@open-mercato/telemetry/browser'
import { resetBrowserTelemetryBootstrap } from '../../../../../telemetry/src/browser/BrowserTelemetry'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import customerPolish from '@open-mercato/core/modules/customers/i18n/pl.json'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { AddressTiles } from '../AddressTiles'

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true })

const mockExportedSpans: ReadableSpan[] = []
const mockExporterCreated = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/people/person-1',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ TabEmptyState: () => null }))
jest.mock('@opentelemetry/instrumentation', () => ({
  ...jest.requireActual<typeof import('@opentelemetry/instrumentation')>('@opentelemetry/instrumentation'),
  registerInstrumentations: () => undefined,
}))
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(config: { url: string }) {
      mockExporterCreated(config)
    }
    export(spans: ReadableSpan[], callback: (result: { code: number }) => void) {
      mockExportedSpans.push(...spans)
      callback({ code: 0 })
    }
    async shutdown() {}
  },
}))

const config: BrowserTelemetryConfig = {
  endpoint: '/api/telemetry/browser-traces',
  serviceName: 'address-browser-test',
  environment: 'test',
  samplingRatio: 1,
}
const translator = createFallbackTranslator(customerPolish)

function renderAddresses(telemetry: BrowserTelemetryConfig | null, failure: Error) {
  return renderWithProviders(
    <>
      <AddressTiles
        addresses={[{ id: 'address-1', name: 'Biuro', purpose: 'office', addressLine1: 'Długa 1' }]}
        onCreate={async () => undefined}
        t={translator}
        emptyLabel="Brak adresów"
        addressTypesAdapter={{ list: async () => { throw failure } }}
      />
      <BrowserTelemetry config={telemetry} />
    </>,
  )
}

describe('address errors through the normal BrowserTelemetry entry', () => {
  beforeEach(() => {
    resetBrowserTelemetryBootstrap()
    mockExportedSpans.length = 0
    mockExporterCreated.mockClear()
    jest.mocked(flash).mockClear()
  })

  afterEach(() => resetBrowserTelemetryBootstrap())

  it('keeps the localized readable fallback without starting an exporter while browser telemetry is off', async () => {
    renderAddresses(null, new Error('[internal] dictionary unavailable'))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Nie udało się wczytać typów adresów', 'error'))
    expect(screen.getByText('office')).toBeInTheDocument()
    expect(mockExporterCreated).not.toHaveBeenCalled()
    expect(mockExportedSpans).toEqual([])
  })

  it('exports an initial dictionary rejection through the real browser SDK and shared reporter registration', async () => {
    const failure = new Error('[internal] dictionary unavailable')
    expect(getTelemetryRuntime()).toBeUndefined()
    renderAddresses(config, failure)
    expect(mockExporterCreated).not.toHaveBeenCalled()
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Nie udało się wczytać typów adresów', 'error'))
    expect(screen.getByText('Biuro')).toBeInTheDocument()
    expect(screen.getByText('office')).toBeInTheDocument()
    await waitFor(() => expect(mockExporterCreated).toHaveBeenCalledWith({ url: config.endpoint }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    await waitFor(() => expect(mockExportedSpans).toHaveLength(1))
    expect(mockExportedSpans[0]).toMatchObject({
      name: 'browser.error',
      attributes: { module: 'ui', 'error.code': 'ui.address_types_load_failed' },
      status: { code: 2 },
      events: [{ name: 'exception', attributes: {
        'exception.type': failure.name,
        'exception.message': failure.message,
        'exception.stacktrace': failure.stack,
      } }],
    })
  })

  it('keeps feedback and fallback when browser SDK initialization fails without retrying', async () => {
    mockExporterCreated.mockImplementationOnce(() => { throw new Error('[internal] exporter unavailable') })
    renderAddresses(config, new Error('[internal] dictionary unavailable'))
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Nie udało się wczytać typów adresów', 'error'))
    await waitFor(() => expect(mockExporterCreated).toHaveBeenCalledTimes(1))
    expect(screen.getByText('office')).toBeInTheDocument()
    expect(mockExportedSpans).toEqual([])
  })
})
