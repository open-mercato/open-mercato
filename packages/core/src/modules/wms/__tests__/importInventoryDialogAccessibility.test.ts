import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'backend', 'ImportInventoryDialog.tsx'),
  'utf8',
)

describe('ImportInventoryDialog accessibility', () => {
  it.each([
    ['reconcileMode', 'wms.backend.inventory.import.upload.reconcileMode'],
    ['skipDuplicates', 'wms.backend.inventory.import.review.skipDuplicates'],
  ])('gives the %s switch a translated accessible name', (state, translationKey) => {
    const switchMarkup = [...source.matchAll(/<Switch[\s\S]*?\/>/g)]
      .map(([markup]) => markup)
      .find((markup) => markup.includes(`checked={${state}}`))

    expect(switchMarkup).toBeDefined()
    expect(switchMarkup).toMatch(
      new RegExp(`aria-label=\\{t\\(\\s*'${translationKey.replaceAll('.', '\\.')}'`),
    )
  })
})
