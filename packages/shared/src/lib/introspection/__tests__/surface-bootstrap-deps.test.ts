import { resolveBootstrapFilesForSurfaces } from '../surface-bootstrap-deps'

describe('resolveBootstrapFilesForSurfaces', () => {
  it('loads only event dependencies for a single event surface', () => {
    const files = resolveBootstrapFilesForSurfaces({ surfaceIds: ['event'], maxTier: 1 })
    expect([...files].sort()).toEqual(['events'])
  })

  it('loads route manifests for api-route only', () => {
    const files = resolveBootstrapFilesForSurfaces({ surfaceIds: ['api-route'], maxTier: 1 })
    expect([...files]).toEqual(['bootstrapRegistrations'])
  })

  it('loads notification and ai-tool files independently', () => {
    expect([...resolveBootstrapFilesForSurfaces({ surfaceIds: ['notification'], maxTier: 1 })]).toEqual(['notifications'])
    expect([...resolveBootstrapFilesForSurfaces({ surfaceIds: ['ai-tool'], maxTier: 1 })]).toEqual(['aiTools'])
  })
})
