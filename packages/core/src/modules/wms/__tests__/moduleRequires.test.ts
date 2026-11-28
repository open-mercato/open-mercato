/** @jest-environment node */
import { metadata } from '../index'

describe('wms module requires (#9216)', () => {
  it('does not hard-require the optional customers and feature_toggles peers', () => {
    expect(metadata.requires).not.toContain('customers')
    expect(metadata.requires).not.toContain('feature_toggles')
  })

  it('keeps catalog and sales as hard dependencies', () => {
    expect(metadata.requires).toEqual(expect.arrayContaining(['catalog', 'sales']))
  })
})
