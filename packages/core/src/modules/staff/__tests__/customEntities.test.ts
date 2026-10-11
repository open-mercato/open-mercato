/** @jest-environment node */
/**
 * EP-43 — what `ce.ts` declares, and what it deliberately does not.
 *
 * The five time-tracking ids are SYSTEM entities, which means `entities install` seeds
 * only their `fields` and never writes a `custom_entities` row. `labelField` is the one
 * property read at runtime today (`attachments/lib/assignmentDetails.ts`), so the test
 * pins it against the ORM entity that owns it rather than against a copy of the string.
 */
import fs from 'node:fs'
import path from 'node:path'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import entities from '../ce'

const moduleRoot = path.join(__dirname, '..')
const entitiesSource = fs.readFileSync(path.join(moduleRoot, 'data', 'entities.ts'), 'utf8')

const TIME_TRACKING_ENTITY_IDS = [
  E.staff.staff_time_entry,
  E.staff.staff_time_project,
  E.staff.staff_time_task,
  E.staff.staff_time_report,
  E.staff.staff_time_tag,
]

describe('staff ce.ts', () => {
  it('declares the employee plus the five time-tracking entities', () => {
    expect(entities.map((entity) => entity.id)).toEqual([
      E.staff.staff_team_member,
      ...TIME_TRACKING_ENTITY_IDS,
    ])
  })

  it('keeps every time-tracking entity out of the sidebar', () => {
    for (const id of TIME_TRACKING_ENTITY_IDS) {
      const spec = entities.find((entity) => entity.id === id)
      expect({ id, showInSidebar: spec?.showInSidebar }).toEqual({ id, showInSidebar: false })
    }
  })

  it('names a labelField that is a real property of the owning ORM entity', () => {
    const expected: Record<string, string> = {
      [E.staff.staff_time_entry]: 'notes',
      [E.staff.staff_time_project]: 'name',
      [E.staff.staff_time_task]: 'title',
      [E.staff.staff_time_report]: 'title',
      [E.staff.staff_time_tag]: 'label',
    }
    for (const id of TIME_TRACKING_ENTITY_IDS) {
      const spec = entities.find((entity) => entity.id === id)
      expect({ id, labelField: spec?.labelField }).toEqual({ id, labelField: expected[id] })
      expect(entitiesSource).toContain(`  ${expected[id]}`)
    }
  })

  /**
   * Ships no default custom fields. A field declared here would be seeded into every
   * tenant, and the write path that would persist a value for it does not exist yet —
   * the time-tracking CRUD routes are command-backed and the factory only persists
   * `customFields` on its ORM write path. See AGENTS.md → "Time-tracking custom fields".
   */
  it('ships no default custom fields for the time-tracking entities', () => {
    for (const id of TIME_TRACKING_ENTITY_IDS) {
      const spec = entities.find((entity) => entity.id === id)
      expect({ id, fields: spec?.fields }).toEqual({ id, fields: [] })
    }
  })
})
