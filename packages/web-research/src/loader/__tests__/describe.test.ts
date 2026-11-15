import { z } from 'zod'
import { defineAdapterModule, type AdapterModule } from '../../contract/adapter'
import { CONTRACT_VERSION } from '../../contract/version'
import { createFakeAdapter } from '../../testing/fakeAdapter'
import { SECRET_PLACEHOLDER, describeOptionsSchema, maskSecrets, unmaskSecrets } from '../describe'

const moduleWith = (schema: z.ZodType<Record<string, unknown>>): AdapterModule<unknown> =>
  defineAdapterModule({
    id: 'fixture',
    kind: 'api',
    contractVersion: CONTRACT_VERSION,
    optionsSchema: schema,
    createAdapter: () => createFakeAdapter({ id: 'fixture' }),
  }) as unknown as AdapterModule<unknown>

describe('describeOptionsSchema', () => {
  it('describes each primitive kind', () => {
    const fields = describeOptionsSchema(
      moduleWith(
        z.object({
          apiKey: z.string().optional(),
          depth: z.enum(['basic', 'advanced']).optional(),
          timeoutMs: z.number().int().optional(),
          enabled: z.boolean().optional(),
          engines: z.array(z.string()).optional(),
        }),
      ),
    )

    expect(fields.map((field) => [field.name, field.kind])).toEqual([
      ['apiKey', 'string'],
      ['depth', 'enum'],
      ['timeoutMs', 'number'],
      ['enabled', 'boolean'],
      ['engines', 'stringList'],
    ])
    expect(fields.find((field) => field.name === 'depth')?.choices).toEqual(['basic', 'advanced'])
  })

  // A host capability (a model resolver, a sidecar handle) is declared with
  // z.custom. Rendering it would put a function in an admin form.
  it('skips host-capability fields declared with z.custom', () => {
    const fields = describeOptionsSchema(
      moduleWith(
        z.object({
          apiKey: z.string().optional(),
          resolveModel: z.custom<() => void>((value) => typeof value === 'function').optional(),
          generate: z.custom<() => void>((value) => typeof value === 'function').optional(),
        }),
      ),
    )
    expect(fields.map((field) => field.name)).toEqual(['apiKey'])
  })

  it('marks credential-shaped names as secret', () => {
    const fields = describeOptionsSchema(
      moduleWith(
        z.object({
          apiKey: z.string().optional(),
          accessToken: z.string().optional(),
          password: z.string().optional(),
          baseUrl: z.string().optional(),
          engines: z.array(z.string()).optional(),
        }),
      ),
    )
    const secrets = fields.filter((field) => field.secret).map((field) => field.name)
    expect(secrets).toEqual(['apiKey', 'accessToken', 'password'])
  })

  it('reports required vs optional and carries the string format', () => {
    const fields = describeOptionsSchema(
      moduleWith(z.object({ baseUrl: z.url(), label: z.string().optional() })),
    )
    expect(fields.find((field) => field.name === 'baseUrl')).toMatchObject({
      required: true,
      format: 'url',
    })
    expect(fields.find((field) => field.name === 'label')?.required).toBe(false)
  })

  it('returns nothing for a schema that is not an object', () => {
    expect(describeOptionsSchema(moduleWith(z.string() as never))).toEqual([])
  })
})

describe('secret round-trip', () => {
  const fields = describeOptionsSchema(
    moduleWith(z.object({ apiKey: z.string().optional(), baseUrl: z.string().optional() })),
  )

  it('never echoes a stored secret back to the client', () => {
    const masked = maskSecrets({ apiKey: 'sk-live-123', baseUrl: 'https://x' }, fields)
    expect(masked.apiKey).toBe(SECRET_PLACEHOLDER)
    expect(masked.baseUrl).toBe('https://x')
  })

  it('leaves an unset secret unset rather than masking nothing', () => {
    expect(maskSecrets({ baseUrl: 'https://x' }, fields).apiKey).toBeUndefined()
  })

  it('keeps the stored secret when the client sends the placeholder back', () => {
    const merged = unmaskSecrets(
      { apiKey: SECRET_PLACEHOLDER, baseUrl: 'https://new' },
      { apiKey: 'sk-live-123', baseUrl: 'https://old' },
      fields,
    )
    expect(merged).toEqual({ apiKey: 'sk-live-123', baseUrl: 'https://new' })
  })

  it('accepts a genuinely new secret', () => {
    const merged = unmaskSecrets({ apiKey: 'sk-live-new' }, { apiKey: 'sk-live-old' }, fields)
    expect(merged.apiKey).toBe('sk-live-new')
  })

  it('drops the placeholder when nothing was stored, rather than persisting it', () => {
    expect(unmaskSecrets({ apiKey: SECRET_PLACEHOLDER }, {}, fields).apiKey).toBeUndefined()
  })
})
