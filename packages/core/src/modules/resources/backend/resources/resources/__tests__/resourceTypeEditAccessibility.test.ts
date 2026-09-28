import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('resource type edit action accessibility', () => {
  it('includes the resource type name in the edit action label', () => {
    expect(source).toContain(
      "t('resources.resourceTypes.actions.editNamed', 'Edit {resourceType}'",
    )
    expect(source).toContain('resourceType: row.original.name')
    expect(source).toContain('aria-label={editLabel}')
  })
})
