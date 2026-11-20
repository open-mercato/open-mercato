import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { createFallbackTranslator } from '../../i18n/translate'
import { CrudHttpError } from '../errors'
import { guardWriteBody, type CrudWriteGuardConfig } from '../write-payload'

const schema = z.object({ id: z.string(), ownerUserId: z.string().optional() })
const scenarios: Array<{ key: string; body: Record<string, unknown>; config?: CrudWriteGuardConfig }> = [
  { key: 'conflicting_field', body: { id: 'record', ownerUserId: 'first', owner_user_id: 'second' } },
  { key: 'immutable_field', body: { id: 'record', entityId: 'parent' }, config: { immutableFields: ['entityId'] } },
  { key: 'unknown_field', body: { id: 'record', made_up: true }, config: { rejectUnknownFields: true } },
]

describe.each(['en', 'pl', 'de', 'es', 'ko'])('write guard defaults in %s', (locale) => {
  const dictionaryPath = resolve(__dirname, `../../../../../../apps/mercato/src/i18n/${locale}.json`)
  const dictionary: Record<string, string> = JSON.parse(readFileSync(dictionaryPath, 'utf8'))
  const translate = createFallbackTranslator(dictionary)

  it.each(scenarios)('translates $key using the shipped dictionary', ({ key, body, config }) => {
    const expected = dictionary[`errors.write_guard.${key}`]
    expect(typeof expected).toBe('string')
    expect(expected.length).toBeGreaterThan(0)
    try {
      guardWriteBody(schema, body, { ...config, translate })
      throw new Error('[internal] Expected write guard rejection')
    } catch (error: unknown) {
      if (!(error instanceof CrudHttpError)) throw error
      expect(error.status).toBe(400)
      expect(error.body).toMatchObject({ error: expected })
      if (key === 'conflicting_field') {
        expect(error.body).toMatchObject({
          details: dictionary['errors.write_guard.conflicting_field_details']
            .replace('{snake}', 'owner_user_id').replace('{camel}', 'ownerUserId'),
        })
      }
    }
  })

  it('ships the same dictionary in the standalone template', () => {
    const templatePath = resolve(__dirname, `../../../../../../packages/create-app/template/src/i18n/${locale}.json`)
    expect(readFileSync(templatePath, 'utf8')).toBe(readFileSync(dictionaryPath, 'utf8'))
  })
})
