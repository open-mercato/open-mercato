import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const guidePath = path.join(packageRoot, 'agentic/guides/customers-calendar.md')

test('Customers calendar harness routes add, remove and modify requests to module-owned examples', () => {
  const guide = fs.readFileSync(guidePath, 'utf8')
  const catalog = JSON.parse(fs.readFileSync(path.join(packageRoot, 'agentic/shared/ai/harness/cases.json'), 'utf8')) as Array<{
    id: string
    owner: { path: string }
    context: { required: string[] }
    requiredDecisions: string[]
  }>
  const record = catalog.find((entry) => entry.id === 'OMH-238')
  assert.ok(record)
  assert.equal(record.owner.path, '.ai/guides/customers-calendar.md')
  assert.ok(record.context.required.includes(record.owner.path))
  for (const decision of ['calendar-module-owned', 'calendar-add-patch-preserve', 'calendar-historical-fallback', 'optional-staff-resources', 'named-booking-conflicts']) {
    assert.ok(record.requiredDecisions.includes(decision))
  }
  for (const token of ['CalendarEventTypeWidget', 'eventTypes', 'eventTypeOverrides', 'eventTypePatches', 'calendar:customers.event-types', 'note: null', 'removeSource', 'CrudForm', 'InjectionSpot']) {
    assert.ok(guide.includes(token), `missing calendar contract ${token}`)
  }
  for (const filename of ['calendar-event-types.ts', 'eventTypeResolver.ts', 'calendar-visit/widget.ts', 'visit-availability/widget.ts', 'visitAvailability.ts', 'VisitPanel.tsx']) {
    assert.ok(guide.includes(`${filename})`), `missing exact source link ${filename}`)
  }
  assert.match(guide, /The shipped example preserves all six baseline types with either flag value/)
  assert.match(guide, /In your own app module, use `eventTypeOverrides: \{ note: null \}`/)
  for (const token of ['display name', 'example.calendar.visitAvailability.booked', 'excludeInteractionId', 'half-open', 'Canceled and deleted', 'every event type']) {
    assert.ok(guide.includes(token), `missing booking contract ${token}`)
  }
  const extensions = fs.readFileSync(path.join(packageRoot, 'agentic/guides/extensions.md'), 'utf8')
  assert.match(extensions, /\]\(customers-calendar\.md\)/)
  assert.doesNotMatch(guide, /overrides\.calendar|calendarEventTypeKeys/)
})
