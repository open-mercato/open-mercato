/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { getBrandStyle, saveBrandStyle } from '@open-mercato/ui/theme/brand-style'
import english from '../../i18n/en.json'
import { StyleAgents } from '../components/StyleAgents'
import { readBrandLogo, studioBrandStyle } from '../components/styleAgentBranding'
import { createColorStudio, type ColorStudio } from '../components/colorStudio'
import { contrastRatio } from '../components/colorPreview'

jest.mock('@open-mercato/ui/theme/brand-style', () => ({ getBrandStyle: jest.fn(() => null), saveBrandStyle: jest.fn() }))
jest.mock('../components/ColorPlayground', () => ({
  ColorPlayground: ({ onStudioChange, logo, initialSeeds }: { onStudioChange: (studio: ColorStudio, valid: boolean) => void; logo: string | null; initialSeeds?: ColorStudio['seeds'] }) => {
    React.useEffect(() => { onStudioChange(createColorStudio(initialSeeds?.primary ?? '#F4700D'), true) }, [onStudioChange, initialSeeds])
    return <div><span data-testid="draft-logo">{logo}</span><button onClick={() => onStudioChange(createColorStudio('#2563EB'), true)}>Change draft</button><button onClick={() => onStudioChange(createColorStudio('#2563EB'), false)}>Invalid draft</button></div>
  },
}))

const save = jest.mocked(saveBrandStyle)
function mount() { return render(<I18nProvider locale="en" dict={english}><StyleAgents /></I18nProvider>) }
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getBrandStyle).mockReturnValue(null); save.mockImplementation(() => {}) })

it('keeps edits local until Apply and restores system defaults without discarding the draft', async () => {
  mount()
  fireEvent.click(screen.getByText('Change draft'))
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ version: 1, seeds: expect.objectContaining({ primary: '#2563EB' }) }))
  expect(screen.getByRole('status')).toHaveTextContent('Style applied')
  fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }))
  expect(save).toHaveBeenLastCalledWith(null)
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ seeds: expect.objectContaining({ primary: '#2563EB' }) }))
})

it('blocks invalid draft application and reports persistence failures', () => {
  mount()
  fireEvent.click(screen.getByText('Invalid draft'))
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  fireEvent.click(screen.getByText('Change draft'))
  save.mockImplementation(() => { throw new Error('storage unavailable') })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  expect(screen.queryByRole('status')).toBeNull()
})

it('rehydrates the applied palette on return', () => {
  jest.mocked(getBrandStyle).mockReturnValue(studioBrandStyle(createColorStudio('#0F766E'), null))
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ seeds: expect.objectContaining({ primary: '#0F766E' }) }))
})

it('rejects unsupported and oversized uploads before changing the draft', async () => {
  mount()
  const upload = screen.getByLabelText('Upload logo', { selector: 'input' })
  fireEvent.change(upload, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('SVG is not supported')
  fireEvent.change(upload, { target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] } })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no larger than 1 MB'))
  expect(screen.getByTestId('draft-logo')).toBeEmptyDOMElement()
  expect(save).not.toHaveBeenCalled()
})

it('exports only supported brand tokens with readable text across every gradient stop', () => {
  for (const color of ['#F4700D', '#FFFFFF', '#000000', '#FFFF00', '#BC9AFF', '#00D66E']) {
    const style = studioBrandStyle(createColorStudio(color), null)
    for (const theme of [style.light, style.dark]) {
      expect(Object.keys(theme)).toHaveLength(7)
      expect(theme['--status-error-text']).toBeUndefined()
      expect(theme['--accent-indigo']).toBeUndefined()
      for (const stop of ['--brand-lime', '--brand-yellow', '--brand-violet']) expect(contrastRatio(theme[stop], theme['--brand-violet-foreground'])).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it('checks image decode and dimensions before accepting upload data', async () => {
  const original = window.Image
  let invalid = false
  let broken = false
  class DecodedImage {
    naturalWidth = 320
    naturalHeight = 80
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      this.naturalWidth = invalid ? 5000 : 320
      queueMicrotask(() => broken ? this.onerror?.() : this.onload?.())
    }
  }
  window.Image = DecodedImage as unknown as typeof Image
  try {
    const file = new File(['image'], 'logo.png', { type: 'image/png' })
    await expect(readBrandLogo(file)).resolves.toMatch(/^data:image\/png;base64,/)
    invalid = true
    await expect(readBrandLogo(file)).rejects.toThrow('fileDimensions')
    broken = true
    await expect(readBrandLogo(file)).rejects.toThrow('fileDecode')
  } finally { window.Image = original }
})

it('passes generated styles through the real persisted runtime validator', () => {
  const runtime = jest.requireActual<typeof import('@open-mercato/ui/theme/brand-style')>('@open-mercato/ui/theme/brand-style')
  try {
    for (const color of ['#F4700D', '#FFFFFF', '#000000', '#FFFF00', '#BC9AFF']) {
      const style = studioBrandStyle(createColorStudio(color), null)
      expect(() => runtime.saveBrandStyle(style)).not.toThrow()
      expect(runtime.getBrandStyle()).toEqual(style)
    }
  } finally { runtime.saveBrandStyle(null) }
})

it('ignores older uploads and applies only the latest decoded logo on explicit Apply', async () => {
  const original = window.Image
  const pending: Array<{ src: string; done: () => void }> = []
  class DeferredImage {
    naturalWidth = 200
    naturalHeight = 80
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) { pending.push({ src: value, done: () => this.onload?.() }) }
  }
  window.Image = DeferredImage as unknown as typeof Image
  try {
    mount()
    const input = screen.getByLabelText('Upload logo', { selector: 'input' })
    fireEvent.change(input, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } })
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    fireEvent.change(input, { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } })
    await waitFor(() => expect(pending).toHaveLength(2))
    pending[1].done()
    await waitFor(() => expect(screen.getByTestId('draft-logo')).toHaveTextContent(pending[1].src))
    pending[0].done()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled())
    expect(screen.getByTestId('draft-logo')).toHaveTextContent(pending[1].src)
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ logo: pending[1].src }))
  } finally { window.Image = original }
})
