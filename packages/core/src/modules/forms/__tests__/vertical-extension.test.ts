import { FieldTypeRegistry } from '../schema/field-type-registry'
import {
  DEMO_RATING_STARS_TYPE_KEY,
  demoRatingStarsSpec,
  registerVerticalDemoTypes,
} from '../schema/field-type-registry-advanced'
import { FormVersionCompiler, FormCompilationError } from '../services/form-version-compiler'

describe('Vertical extension demo type', () => {
  it('registers demo.rating_stars on a fresh registry', () => {
    const registry = new FieldTypeRegistry()
    registerVerticalDemoTypes(registry)
    expect(registry.has(DEMO_RATING_STARS_TYPE_KEY)).toBe(true)
    const spec = registry.get(DEMO_RATING_STARS_TYPE_KEY)
    expect(spec).toEqual(demoRatingStarsSpec)
  })

  it('rates pass validator within bounds, fail outside', () => {
    const fieldNode = { 'x-om-min': 1, 'x-om-max': 5 }
    expect(demoRatingStarsSpec.validator(3, fieldNode)).toBe(true)
    expect(demoRatingStarsSpec.validator(0, fieldNode)).not.toBe(true)
    expect(demoRatingStarsSpec.validator(6, fieldNode)).not.toBe(true)
    expect(demoRatingStarsSpec.validator('three' as never, fieldNode)).not.toBe(true)
  })

  it('exporter produces a star symbol', () => {
    expect(demoRatingStarsSpec.exportAdapter(4)).toBe('4 ★')
    expect(demoRatingStarsSpec.exportAdapter(undefined)).toBe('')
  })
})

describe('Compiler regression — unregistered vertical type fails publish', () => {
  it('rejects schemas referencing an unregistered type with FormCompilationError', () => {
    const registry = new FieldTypeRegistry()
    // Bare registry: no types registered.
    const compiler = new FormVersionCompiler({ registry })
    expect(() =>
      compiler.compile({
        id: 'v1',
        updatedAt: new Date(),
        schema: {
          type: 'object',
          'x-om-roles': ['admin'],
          'x-om-default-actor-role': 'admin',
          properties: {
            quality: {
              type: 'number',
              'x-om-type': 'dental.tooth_chart',
              'x-om-editable-by': ['admin'],
            },
          },
        },
        uiSchema: {},
      }),
    ).toThrow(FormCompilationError)
  })

  it('accepts a registered vertical type', () => {
    const registry = new FieldTypeRegistry()
    registerVerticalDemoTypes(registry)
    const compiler = new FormVersionCompiler({ registry })
    expect(() =>
      compiler.compile({
        id: 'v2',
        updatedAt: new Date(),
        schema: {
          type: 'object',
          'x-om-roles': ['admin'],
          'x-om-default-actor-role': 'admin',
          properties: {
            score: {
              type: 'integer',
              'x-om-type': DEMO_RATING_STARS_TYPE_KEY,
              'x-om-min': 1,
              'x-om-max': 5,
              'x-om-editable-by': ['admin'],
            },
          },
        },
        uiSchema: {},
      }),
    ).not.toThrow()
  })
})
