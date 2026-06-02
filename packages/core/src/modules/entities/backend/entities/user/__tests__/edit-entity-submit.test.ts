jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { buildEntityMetadataPayload } from '../[entityId]/page'

describe('buildEntityMetadataPayload', () => {
  describe('code-sourced (system) entities', () => {
    it('returns a payload with label, description, and defaultEditor', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        description: 'Some description',
        defaultEditor: 'markdown',
      })
      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        label: 'My Entity',
        description: 'Some description',
        defaultEditor: 'markdown',
      })
    })

    it('returns a payload even when only label is provided', () => {
      const result = buildEntityMetadataPayload('code', { label: 'System Entity' })
      expect(result).not.toBeNull()
      expect(result?.label).toBe('System Entity')
    })

    it('does not include showInSidebar in the payload', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        showInSidebar: true,
      })
      expect(result).not.toBeNull()
      expect(result).not.toHaveProperty('showInSidebar')
    })

    it('normalizes empty string defaultEditor to undefined', () => {
      const result = buildEntityMetadataPayload('code', {
        label: 'My Entity',
        defaultEditor: '',
      })
      expect(result).not.toBeNull()
      expect(result?.defaultEditor).toBeUndefined()
    })
  })

  describe('custom entities', () => {
    it('returns a payload with showInSidebar', () => {
      const result = buildEntityMetadataPayload('custom', {
        label: 'Custom Entity',
        description: 'Custom description',
        showInSidebar: true,
      })
      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        label: 'Custom Entity',
        description: 'Custom description',
        showInSidebar: true,
      })
    })

    it('returns a valid payload when showInSidebar is not provided', () => {
      const result = buildEntityMetadataPayload('custom', { label: 'Custom Entity' })
      expect(result).not.toBeNull()
      expect(result?.label).toBe('Custom Entity')
    })
  })

  it('returns null when label is missing', () => {
    const result = buildEntityMetadataPayload('code', { description: 'No label here' })
    expect(result).toBeNull()
  })

  it('returns null when label is empty', () => {
    const result = buildEntityMetadataPayload('custom', { label: '' })
    expect(result).toBeNull()
  })
})
