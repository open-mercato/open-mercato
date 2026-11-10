import fs from 'node:fs'
import path from 'node:path'

const localeRoot = path.resolve(__dirname, '../../../../i18n')
const helperKey = 'example.widgets.catalogSeoReport.docs'
const helperText: Record<string, string> = {
  en: 'This widget is injected into the products table via the injection system.',
  pl: 'Ten widżet jest dodawany do tabeli produktów za pomocą systemu wstrzykiwania widżetów.',
  de: 'Dieses Widget wird über das Widget-Injection-System in die Produkttabelle eingefügt.',
  es: 'Este widget se inserta en la tabla de productos mediante el sistema de inyección de widgets.',
  ko: '이 위젯은 위젯 삽입 시스템을 통해 제품 테이블에 삽입됩니다.',
}

describe('Catalog SEO helper localization', () => {
  it.each(fs.readdirSync(localeRoot).filter((file) => file.endsWith('.json')))('%s has localized helper copy instead of the English fallback', (file) => {
    const locale = path.basename(file, '.json')
    const dictionary: Record<string, string> = JSON.parse(fs.readFileSync(path.join(localeRoot, file), 'utf8'))
    expect(dictionary[helperKey]).toBe(helperText[locale])
    expect(dictionary[helperKey]).toBeTruthy()
    if (locale !== 'en') expect(dictionary[helperKey]).not.toBe(helperText.en)
  })
})
