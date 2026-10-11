import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * U9: dnd-kit narrates every drag through a live region and ships English defaults when
 * `accessibility.announcements` is unset. The board now supplies its own strings, so those
 * keys — and the keyboard move affordance that replaces the dead keyboard sensor (U3) —
 * MUST exist and be genuinely translated in every shipped locale.
 */
const BOARD_A11Y_KEYS = [
  'staff.time_tracking.board.card.addTimeAria',
  'staff.time_tracking.board.card.moveTo.aria',
  'staff.time_tracking.board.card.moveTo.cta',
  'staff.time_tracking.board.card.moveTo.menu',
  'staff.time_tracking.board.card.startTimerAria',
  'staff.time_tracking.board.card.stopTimerAria',
  'staff.time_tracking.board.dnd.dragCancel',
  'staff.time_tracking.board.dnd.dragEnd',
  'staff.time_tracking.board.dnd.dragEndOutside',
  'staff.time_tracking.board.dnd.dragOver',
  'staff.time_tracking.board.dnd.dragOverNothing',
  'staff.time_tracking.board.dnd.dragStart',
  'staff.time_tracking.board.dnd.instructions',
] as const

function loadLocale(locale: string): Record<string, string> {
  const file = path.join(__dirname, '..', '..', '..', 'i18n', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
}

describe('kanban board accessibility translations', () => {
  const en = loadLocale('en')

  it('declares every announcement and move-menu key in English', () => {
    for (const key of BOARD_A11Y_KEYS) {
      expect(typeof en[key]).toBe('string')
      expect(en[key].trim().length).toBeGreaterThan(0)
    }
  })

  it.each(['pl', 'de', 'es', 'ko'])('%s translates them away from English', (locale) => {
    const messages = loadLocale(locale)
    for (const key of BOARD_A11Y_KEYS) {
      const value = messages[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toBe(en[key])
    }
  })

  // WCAG 2.5.3 Label in Name: the accessible name of a quick action MUST still contain the
  // words printed on it, or speech-input users cannot address the button they can see.
  const LABELLED_ACTIONS = [
    ['staff.time_tracking.board.card.startTimer', 'staff.time_tracking.board.card.startTimerAria'],
    ['staff.time_tracking.board.card.stopTimer', 'staff.time_tracking.board.card.stopTimerAria'],
    ['staff.time_tracking.board.card.addTime', 'staff.time_tracking.board.card.addTimeAria'],
    ['staff.time_tracking.board.card.moveTo.cta', 'staff.time_tracking.board.card.moveTo.aria'],
  ] as const

  it.each(['en', 'pl', 'de', 'es', 'ko'])('%s keeps the visible action wording inside its aria label', (locale) => {
    const messages = loadLocale(locale)
    for (const [visibleKey, ariaKey] of LABELLED_ACTIONS) {
      expect(messages[ariaKey]).toContain(messages[visibleKey])
    }
  })

  it.each(['pl', 'de', 'es', 'ko'])('%s keeps every placeholder the English string uses', (locale) => {
    const messages = loadLocale(locale)
    for (const key of BOARD_A11Y_KEYS) {
      const expected = Array.from(en[key].matchAll(/\{(\w+)\}/g)).map((match) => match[1]).sort()
      const actual = Array.from(messages[key].matchAll(/\{(\w+)\}/g)).map((match) => match[1]).sort()
      expect(actual).toEqual(expected)
    }
  })
})
