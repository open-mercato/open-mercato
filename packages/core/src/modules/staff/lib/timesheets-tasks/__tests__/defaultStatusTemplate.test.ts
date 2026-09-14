import { PROJECT_COLOR_KEYS } from '../../timesheets-ui/colors'
import { STATUS_POSITION_GAP } from '../statusPositions'
import { DEFAULT_TASK_STATUS_TEMPLATE, buildDefaultTaskStatusRows } from '../defaultStatusTemplate'

const echoFallback = (_key: string, fallback: string) => fallback

describe('DEFAULT_TASK_STATUS_TEMPLATE', () => {
  it('is the four columns screen 6 draws, in board order', () => {
    expect(DEFAULT_TASK_STATUS_TEMPLATE.map((entry) => entry.slug)).toEqual([
      'backlog',
      'in-progress',
      'in-review',
      'done',
    ])
  })

  it('marks the first column as the landing column and the last as terminal', () => {
    const defaults = DEFAULT_TASK_STATUS_TEMPLATE.filter((entry) => entry.isDefault)
    const done = DEFAULT_TASK_STATUS_TEMPLATE.filter((entry) => entry.isDone)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].slug).toBe('backlog')
    expect(done).toHaveLength(1)
    expect(done[0].slug).toBe('done')
  })

  it('uses DS chart token keys rather than raw colour values', () => {
    for (const entry of DEFAULT_TASK_STATUS_TEMPLATE) {
      expect(PROJECT_COLOR_KEYS).toContain(entry.color)
      expect(entry.color).not.toMatch(/^#/)
    }
  })

  it('carries an i18n key for every label so no English string is seeded blind', () => {
    for (const entry of DEFAULT_TASK_STATUS_TEMPLATE) {
      expect(entry.labelKey).toMatch(/^staff\.time_tracking\.taskStatuses\.defaults\./)
      expect(entry.defaultLabel.length).toBeGreaterThan(0)
    }
  })

  it('keeps slugs unique and in the slug shape the validator accepts', () => {
    const slugs = DEFAULT_TASK_STATUS_TEMPLATE.map((entry) => entry.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })
})

describe('buildDefaultTaskStatusRows', () => {
  it('spaces the seeded board on the gap grid', () => {
    const rows = buildDefaultTaskStatusRows(echoFallback)
    expect(rows.map((row) => row.position)).toEqual([
      STATUS_POSITION_GAP,
      STATUS_POSITION_GAP * 2,
      STATUS_POSITION_GAP * 3,
      STATUS_POSITION_GAP * 4,
    ])
  })

  it('resolves every name through the translator', () => {
    const seen: string[] = []
    const rows = buildDefaultTaskStatusRows((key) => {
      seen.push(key)
      return `t:${key}`
    })
    expect(seen).toEqual(DEFAULT_TASK_STATUS_TEMPLATE.map((entry) => entry.labelKey))
    expect(rows.map((row) => row.name)).toEqual(
      DEFAULT_TASK_STATUS_TEMPLATE.map((entry) => `t:${entry.labelKey}`),
    )
  })

  it('falls back to the English label when a locale has no translation', () => {
    const rows = buildDefaultTaskStatusRows(echoFallback)
    expect(rows.map((row) => row.name)).toEqual(['Backlog', 'In progress', 'In review', 'Done'])
  })

  it('produces exactly one default and at least one done column', () => {
    const rows = buildDefaultTaskStatusRows(echoFallback)
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1)
    expect(rows.filter((row) => row.isDone).length).toBeGreaterThanOrEqual(1)
  })
})
