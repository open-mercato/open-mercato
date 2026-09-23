/**
 * Visual editor navigation helpers (Phase 4 — "Otwórz środek" drill-down).
 */

import { describe, test, expect } from '@jest/globals'
import { buildVisualEditorHref, extractFirstDefinitionId } from '../visual-editor-navigation'

describe('buildVisualEditorHref', () => {
  test('builds the editor route with an encoded id', () => {
    expect(buildVisualEditorHref('abc-123')).toBe('/backend/definitions/visual-editor?id=abc-123')
  })

  test('encodes ids with special characters', () => {
    expect(buildVisualEditorHref('a b/c')).toBe('/backend/definitions/visual-editor?id=a%20b%2Fc')
  })
})

describe('extractFirstDefinitionId', () => {
  test('returns the first row id', () => {
    expect(extractFirstDefinitionId({ data: [{ id: 'child-1' }, { id: 'child-2' }] })).toBe('child-1')
  })

  test('returns null for empty / missing / malformed payloads', () => {
    expect(extractFirstDefinitionId({ data: [] })).toBeNull()
    expect(extractFirstDefinitionId({})).toBeNull()
    expect(extractFirstDefinitionId(null)).toBeNull()
    expect(extractFirstDefinitionId({ data: [{}] })).toBeNull()
    expect(extractFirstDefinitionId({ data: [{ id: '' }] })).toBeNull()
  })
})
