import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'TriggersEditor.tsx'),
  'utf8',
)

describe('workflow trigger row action accessibility', () => {
  it('identifies the trigger in the enabled switch label', () => {
    expect(source).toContain(
      "t('workflows.triggers.fields.enabledNamed', 'Enabled: {trigger}'",
    )
    expect(source).toContain('trigger: triggerLabel')
  })

  it('identifies the trigger in edit and delete action labels', () => {
    expect(source).toContain(
      "t('workflows.triggers.actions.editNamed', 'Edit {trigger}'",
    )
    expect(source).toContain(
      "t('workflows.triggers.actions.deleteNamed', 'Delete {trigger}'",
    )
  })
})
