/** @jest-environment jsdom */

import { render } from '@testing-library/react'

type MockFeature = { properties?: { name?: string } }
type MockPopupLayer = { bindPopup: (content: string | HTMLElement) => void }
type MockGeoJsonOptions = {
  onEachFeature: (feature: MockFeature, layer: MockPopupLayer) => void
}

const mockBindPopup = jest.fn<void, [content: string | HTMLElement]>()
const mockMap = {
  setView: jest.fn(),
  fitBounds: jest.fn(),
  invalidateSize: jest.fn(),
  stop: jest.fn(),
  remove: jest.fn(),
}
const mockGeoJsonLayer = {
  addTo: jest.fn(),
  getBounds: jest.fn(() => ({ isValid: () => false })),
  removeFrom: jest.fn(),
}
mockGeoJsonLayer.addTo.mockReturnValue(mockGeoJsonLayer)

jest.mock('leaflet/dist/leaflet.css', () => ({}))
jest.mock('leaflet', () => ({
  map: jest.fn(() => mockMap),
  control: { zoom: jest.fn(() => ({ addTo: jest.fn() })) },
  tileLayer: jest.fn(() => ({ addTo: jest.fn() })),
  geoJSON: jest.fn((_features: MockFeature[], options: MockGeoJsonOptions) => {
    options.onEachFeature(_features[0], { bindPopup: mockBindPopup })
    return mockGeoJsonLayer
  }),
}))

async function renderFeatureName(name: string) {
  const { default: PlotMapPreviewImpl } = await import('../PlotMapPreviewImpl')
  render(<PlotMapPreviewImpl features={[{ properties: { name } }]} />)
  expect(mockBindPopup).toHaveBeenCalledTimes(1)
  return mockBindPopup.mock.calls[0][0] as string | HTMLElement
}

describe('PlotMapPreviewImpl popup content', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes HTML-looking stored names to Leaflet as text, not markup', async () => {
    const name = '<meta http-equiv="refresh" content="0;url=https://attacker.example"><img src=x onerror=alert(1)>'

    const popupContent = await renderFeatureName(name)

    expect(popupContent).toBeInstanceOf(HTMLElement)
    expect(popupContent.textContent).toBe(name)
    expect(popupContent.querySelector('meta, img')).toBeNull()
  })

  it('preserves ordinary plot names', async () => {
    const popupContent = await renderFeatureName('Plot A')

    expect(popupContent).toBeInstanceOf(HTMLElement)
    expect(popupContent.textContent).toBe('Plot A')
  })
})
