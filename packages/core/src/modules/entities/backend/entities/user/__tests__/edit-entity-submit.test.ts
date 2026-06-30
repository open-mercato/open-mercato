jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

import {
  buildEntityMetadataPayload,
  buildEntitySettingsFields,
  getEntitySettingsNotice,
  shouldRegisterEntityMetadata,
} from '../[entityId]/page'

describe('shouldRegisterEntityMetadata', () => {
  it('registers metadata for custom (user-defined) entities', () => {
    expect(shouldRegisterEntityMetadata('custom')).toBe(true)
  })

  it('does not register metadata for code-declared system entities (#3115)', () => {
    expect(shouldRegisterEntityMetadata('code')).toBe(false)
  })
})

describe('buildEntitySettingsFields', () => {
  const findField = (fields: ReturnType<typeof buildEntitySettingsFields>, id: string) =>
    fields.find((field) => field.id === id)

  describe('code-sourced (system) entities (#3151)', () => {
    const fields = buildEntitySettingsFields('code')

    it('disables label, description, and defaultEditor so code-owned metadata cannot be edited', () => {
      expect(findField(fields, 'label')?.disabled).toBe(true)
      expect(findField(fields, 'description')?.disabled).toBe(true)
      expect(findField(fields, 'defaultEditor')?.disabled).toBe(true)
    })

    it('does not expose the showInSidebar field', () => {
      expect(findField(fields, 'showInSidebar')).toBeUndefined()
    })
  })

  describe('custom entities', () => {
    const fields = buildEntitySettingsFields('custom')

    it('keeps label, description, and defaultEditor editable', () => {
      expect(findField(fields, 'label')?.disabled).toBeFalsy()
      expect(findField(fields, 'description')?.disabled).toBeFalsy()
      expect(findField(fields, 'defaultEditor')?.disabled).toBeFalsy()
    })

    it('exposes an editable showInSidebar field', () => {
      const showInSidebar = findField(fields, 'showInSidebar')
      expect(showInSidebar).toBeDefined()
      expect(showInSidebar?.disabled).toBeFalsy()
    })
  })
})

describe('getEntitySettingsNotice', () => {
  it('returns a read-only notice for code-declared system entities (#3151)', () => {
    const notice = getEntitySettingsNotice('code')
    expect(typeof notice).toBe('string')
    expect(notice).toMatch(/cannot be edited/i)
  })

  it('returns no notice for custom entities', () => {
    expect(getEntitySettingsNotice('custom')).toBeUndefined()
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
