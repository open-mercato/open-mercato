import fs from 'node:fs'
import path from 'node:path'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import {
  composeAccessibleName,
  eventDisplayTitle,
  multiDayEventSpan,
  pluralCategory,
} from '../calendar/labels'

function loadDict(locale: string): Dict {
  const file = path.join(__dirname, `../../i18n/${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Dict
}

function agendaCountLabel(locale: string, count: number): string {
  const t = createFallbackTranslator(loadDict(locale))
  const base = 'customers.calendar.agenda.eventsCount'
  const key = `${base}.${pluralCategory(locale, count)}`
  const out = t(key, undefined, { count })
  return out === key ? t(`${base}.other`, undefined, { count }) : out
}

describe('pluralCategory', () => {
  it('selects Polish 3-form categories', () => {
    expect(pluralCategory('pl', 1)).toBe('one')
    expect(pluralCategory('pl', 2)).toBe('few')
    expect(pluralCategory('pl', 3)).toBe('few')
    expect(pluralCategory('pl', 4)).toBe('few')
    expect(pluralCategory('pl', 5)).toBe('many')
    expect(pluralCategory('pl', 0)).toBe('many')
    expect(pluralCategory('pl', 22)).toBe('few')
  })

  it('selects English categories', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 2)).toBe('other')
  })

  it('falls back when locale is invalid', () => {
    expect(pluralCategory('not-a-locale!!', 1)).toBe('one')
    expect(pluralCategory('not-a-locale!!', 5)).toBe('other')
  })
})

describe('agenda day-group count (regression for #3484 item 1)', () => {
  it('uses the Polish "few" form for 2-4 events', () => {
    expect(agendaCountLabel('pl', 1)).toBe('1 wydarzenie')
    expect(agendaCountLabel('pl', 2)).toBe('2 wydarzenia')
    expect(agendaCountLabel('pl', 3)).toBe('3 wydarzenia')
    expect(agendaCountLabel('pl', 5)).toBe('5 wydarzeń')
  })

  it('keeps the English singular/plural split', () => {
    expect(agendaCountLabel('en', 1)).toBe('1 event')
    expect(agendaCountLabel('en', 4)).toBe('4 events')
  })
})

describe('interaction undo labels (regression for #3484 item 4)', () => {
  it('uses correct Polish diacritics and inflection', () => {
    const pl = loadDict('pl')
    expect(pl['customers.audit.interactions.create']).toBe('Utwórz interakcję')
    expect(pl['customers.audit.interactions.update']).toBe('Zaktualizuj interakcję')
    expect(pl['customers.audit.interactions.cancel']).toBe('Anuluj interakcję')
  })
})

describe('eventDisplayTitle (regression for #3484 item 2)', () => {
  it('falls back when the title is empty or blank', () => {
    expect(eventDisplayTitle('', 'Untitled')).toBe('Untitled')
    expect(eventDisplayTitle('   ', 'Untitled')).toBe('Untitled')
    expect(eventDisplayTitle(null, 'Untitled')).toBe('Untitled')
    expect(eventDisplayTitle(undefined, 'Untitled')).toBe('Untitled')
  })

  it('keeps a real title', () => {
    expect(eventDisplayTitle('Kickoff', 'Untitled')).toBe('Kickoff')
  })
})

describe('composeAccessibleName (regression for #3484 item 3)', () => {
  it('joins name and email with a separator', () => {
    expect(composeAccessibleName(['Arjun Patel', 'arjun.patel@example.com'])).toBe(
      'Arjun Patel, arjun.patel@example.com',
    )
  })

  it('drops empty parts', () => {
    expect(composeAccessibleName(['Acme Inc', null, 'Company'])).toBe('Acme Inc, Company')
    expect(composeAccessibleName(['   ', 'Lena'])).toBe('Lena')
  })

  it('honors a custom separator', () => {
    expect(composeAccessibleName(['a', 'b'], ' · ')).toBe('a · b')
  })
})

describe('multiDayEventSpan (regression for #3484 item 5)', () => {
  it('returns 0 for same-day or invalid ranges', () => {
    expect(multiDayEventSpan('2026-06-21', '2026-06-21')).toBe(0)
    expect(multiDayEventSpan('2026-06-22', '2026-06-21')).toBe(0)
    expect(multiDayEventSpan('2026-06-21', 'not-a-date')).toBe(0)
  })

  it('returns the number of spanned calendar days', () => {
    expect(multiDayEventSpan('2026-06-21', '2026-06-22')).toBe(2)
    expect(multiDayEventSpan('2026-06-21', '2026-06-25')).toBe(5)
  })
})
