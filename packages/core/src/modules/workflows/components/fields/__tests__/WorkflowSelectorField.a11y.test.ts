import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(__dirname, '..', 'WorkflowSelectorField.tsx'), 'utf8')

describe('WorkflowSelectorField accessibility', () => {
  it('gives the icon-only clear button a translated accessible name', () => {
    const clearButton = source.match(
      /<Button[\s\S]*?onClick=\{handleClear\}[\s\S]*?<\/Button>/,
    )?.[0]

    expect(clearButton).toBeDefined()
    expect(clearButton).toContain("aria-label={t('workflows.common.clear')}")
    expect(clearButton).toContain('<X className="size-4" aria-hidden />')
  })
})
