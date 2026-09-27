import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(__dirname, '..', 'NotesSection.tsx'), 'utf8')

describe('NotesSection accessibility', () => {
  it('gives both Markdown toggle buttons a state-aware accessible name', () => {
    expect(source.match(/aria-label=\{markdownToggleLabel\}/g)).toHaveLength(2)
    expect(source).toContain("isMarkdownActive ? 'markdownDisable' : 'markdownEnable'")
  })

  it('labels every icon-only note action', () => {
    expect(source).toContain("aria-label={label('edit', 'Edit note')}")
    expect(source).toContain("aria-label={label('appearance.edit', 'Edit appearance')}")
    expect(source).toContain("aria-label={label('deleteAction', 'Delete note')}")
  })
})
