import { resolveFullWidthIds } from '../components/GalleryShell'

describe('design_system family grid layout', () => {
  const fullWidth = new Set(['wide-a', 'wide-b'])

  it('keeps paired half-width cards side by side', () => {
    expect([...resolveFullWidthIds(['wide-a', 'half-1', 'half-2', 'wide-b'], fullWidth)]).toEqual(['wide-a', 'wide-b'])
  })

  it('stretches a half-width card that has no neighbour before a full-width card', () => {
    expect(resolveFullWidthIds(['half-1', 'half-2', 'half-3', 'wide-a'], fullWidth).has('half-3')).toBe(true)
  })

  it('stretches a trailing unpaired card', () => {
    expect(resolveFullWidthIds(['half-1', 'half-2', 'half-3'], fullWidth).has('half-3')).toBe(true)
  })
})
