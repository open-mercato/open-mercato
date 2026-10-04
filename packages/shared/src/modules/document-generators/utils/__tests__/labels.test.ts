import { createTranslator } from '../../../../lib/i18n/translate'
import { buildLabels } from '../labels'

describe('buildLabels', () => {
  it('translates with defaults', () => {
    const translate = createTranslator({ 'x.labels.a': 'A-pl' })
    expect(buildLabels(['a', 'b'] as const, { a: 'A', b: 'B' }, 'x.labels', translate)).toEqual({ a: 'A-pl', b: 'B' })
  })
})
