import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(__dirname, '..', 'ActivitiesSection.tsx'), 'utf8')

describe('ActivitiesSection accessibility', () => {
  it('labels the icon-only activity actions', () => {
    expect(source).toContain("aria-label={t('editTitle', 'Edit activity')}")
    expect(source).toContain("aria-label={t('deleteAction', 'Delete activity')}")
  })

  it('hides the action icons from the accessibility tree', () => {
    expect(source).toContain('<Pencil className="h-4 w-4" aria-hidden="true" />')
    expect(source).toContain('<Trash2 className="h-4 w-4" aria-hidden="true" />')
  })
})
