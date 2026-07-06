jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import { buildDefinitionsBatchPayload, buildEntityMetadataPayload, shouldRegisterEntityMetadata } from '../[entityId]/page'

describe('shouldRegisterEntityMetadata', () => {
  it('registers metadata for custom (user-defined) entities', () => {
    expect(shouldRegisterEntityMetadata('custom')).toBe(true)
  })

  it('does not register metadata for code-declared system entities (#3115)', () => {
    expect(shouldRegisterEntityMetadata('code')).toBe(false)
  })
})

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

describe('buildDefinitionsBatchPayload', () => {
  it('preserves inactive definitions so inherited fields can be hidden', () => {
    const result = buildDefinitionsBatchPayload({
      entityId: 'customers:customer_deal',
      defs: [
        {
          key: 'hide_me',
          kind: 'text',
          configJson: { label: 'Hide me' },
          isActive: false,
        },
        {
          key: 'keep_me',
          kind: 'text',
          configJson: { label: 'Keep me' },
          isActive: true,
        },
      ],
      fieldsets: [{ code: 'main', label: 'Main' }],
      singleFieldsetPerRecord: true,
    })

    expect(result).toEqual({
      entityId: 'customers:customer_deal',
      definitions: [
        {
          key: 'hide_me',
          kind: 'text',
          configJson: { label: 'Hide me' },
          isActive: false,
        },
        {
          key: 'keep_me',
          kind: 'text',
          configJson: { label: 'Keep me' },
          isActive: true,
        },
      ],
      fieldsets: [{ code: 'main', label: 'Main' }],
      singleFieldsetPerRecord: true,
    })
  })

  it('omits incomplete definitions without keys', () => {
    const result = buildDefinitionsBatchPayload({
      entityId: 'customers:customer_deal',
      defs: [
        {
          key: '',
          kind: 'text',
          configJson: {},
          isActive: true,
        },
      ],
      fieldsets: [],
      singleFieldsetPerRecord: false,
    })

    expect(result.definitions).toEqual([])
    expect(result.singleFieldsetPerRecord).toBe(false)
  })
})
