import pl from '../i18n/pl.json'

type Dictionary = Record<string, string>

const INVENTORY_DIALOG_KEY_PATTERN = /^wms\.backend\.inventory\.(adjust|cycleCount|import)\./

const NUMBER_INVARIANT_WORDS = new Set(['szt.', 'vs', 'netto', 'z'])

const dictionary = pl as Dictionary
const dialogEntries = Object.entries(dictionary).filter(([key]) => INVENTORY_DIALOG_KEY_PATTERN.test(key))

function wordsFollowingPlaceholders(value: string): string[] {
  return Array.from(value.matchAll(/\{\w+\}\s+(\p{L}[\p{L}.]*)/gu), (match) => match[1])
}

describe('WMS inventory dialogs Polish copy', () => {
  it('covers the adjust, cycle count and import dialog keys', () => {
    expect(dialogEntries.length).toBeGreaterThan(100)
  })

  it('never puts an inflected word right after a number placeholder', () => {
    const offending = dialogEntries
      .filter(([, value]) => wordsFollowingPlaceholders(value).some((word) => !NUMBER_INVARIANT_WORDS.has(word)))
      .map(([key, value]) => `${key}: ${value}`)
    expect(offending).toEqual([])
  })

  it('reads correctly for one and for two to four items', () => {
    const render = (key: string, count: number) => dictionary[key].replace(/\{\w+\}/g, String(count))
    expect(render('wms.backend.inventory.cycleCount.steps.counting.subtitleWithPosted', 1)).toBe(
      'Krok 2 z 3 · zapisane pozycje: 1 — zlicz następne SKU',
    )
    expect(render('wms.backend.inventory.cycleCount.steps.counting.finishWarning', 1)).toBe(
      'Pozycje pozostałe w zakresie: 1 — potwierdź wcześniejsze zakończenie.',
    )
    expect(render('wms.backend.inventory.import.actions.importRows', 2)).toBe('Importuj wiersze (2)')
  })

  it('translates the signed delta and bin wording', () => {
    const untranslated = dialogEntries
      .filter(([, value]) => /\bbin|podpisan/iu.test(value.replace(/\{\w+\}/g, '')))
      .map(([key, value]) => `${key}: ${value}`)
    expect(untranslated).toEqual([])
    expect(dictionary['wms.backend.inventory.cycleCount.form.fromBin']).toBe('Lokalizacja początkowa')
    expect(dictionary['wms.backend.inventory.cycleCount.form.toBin']).toBe('Lokalizacja końcowa')
  })
})
