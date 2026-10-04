/** @jest-environment node */
import { readXlsxSheetNames } from '../xlsxSheetNames'
import { buildArchive, packageRelationships } from './xlsxArchive'
import { buildWorkbook } from '../../__integration__/helpers/xlsxWorkbook'

const maxBytes = 1024 * 1024

function workbookXml(sheets: string): string {
  return `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${sheets}</sheets></workbook>`
}

describe('readXlsxSheetNames', () => {
  it('reads sheet names in workbook order from a workbook written by hucre', async () => {
    const workbook = await buildWorkbook([
      { name: 'Oferta', rows: [['a']] },
      { name: 'R&D <2026>', rows: [] },
      { name: 'Ceny "netto"', rows: [] },
    ])

    expect(readXlsxSheetNames(workbook, maxBytes)).toEqual(['Oferta', 'R&D <2026>', 'Ceny "netto"'])
  })

  it('follows the package relationship to the workbook part and decodes prefixed markup', () => {
    const archive = buildArchive([
      packageRelationships('/book/main.xml'),
      {
        name: 'book/main.xml',
        compression: 'deflate',
        content:
          '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets>' +
          `<x:sheet name='Zest&#xF3;w &#8211; 2026' sheetId="1"/>` +
          '<x:sheet sheetId="2" name="A>B &amp; C"/>' +
          '<x:sheet sheetId="3"/>' +
          '</x:sheets></x:workbook>',
      },
    ])

    expect(readXlsxSheetNames(archive, maxBytes)).toEqual(['Zestów – 2026', 'A>B & C', ''])
  })

  it('reads a ZIP64 central directory', () => {
    const archive = buildArchive(
      [
        packageRelationships('xl/workbook.xml'),
        { name: 'xl/workbook.xml', content: workbookXml('<sheet name="Arkusz1" sheetId="1"/>'), compression: 'deflate' },
      ],
      { zip64: true },
    )

    expect(readXlsxSheetNames(archive, maxBytes)).toEqual(['Arkusz1'])
  })

  it('reads the last of duplicate workbook entries, matching the streaming reader', () => {
    const archive = buildArchive([
      packageRelationships('xl/workbook.xml'),
      { name: 'xl/workbook.xml', content: workbookXml('<sheet name="Pierwszy" sheetId="1"/>') },
      { name: 'xl/workbook.xml', content: workbookXml('<sheet name="Ostatni" sheetId="1"/>') },
    ])

    expect(readXlsxSheetNames(archive, maxBytes)).toEqual(['Ostatni'])
  })

  it('scans a workbook part full of unclosed sheet tags in linear time', () => {
    const archive = buildArchive([
      packageRelationships('xl/workbook.xml'),
      { name: 'xl/workbook.xml', content: '<sheet '.repeat(120_000), compression: 'deflate' },
    ])

    const started = performance.now()
    expect(readXlsxSheetNames(archive, maxBytes)).toEqual([])
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('scans package relationships full of unclosed tags in linear time', () => {
    const archive = buildArchive([
      { name: '_rels/.rels', content: '<Relationship Type="x" '.repeat(40_000), compression: 'deflate' },
    ])

    const started = performance.now()
    expect(() => readXlsxSheetNames(archive, maxBytes)).toThrow('no workbook relationship')
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it.each(['stored', 'deflate'] as const)('rejects a %s workbook part larger than the byte cap', (compression) => {
    const archive = buildArchive([
      packageRelationships('xl/workbook.xml'),
      { name: 'xl/workbook.xml', content: workbookXml(`<sheet name="${'x'.repeat(4_096)}"/>`), compression },
    ])

    expect(() => readXlsxSheetNames(archive, 1_024)).toThrow('spreadsheet archive entry exceeds 1024 bytes')
  })

  it.each([
    ['an encrypted (OLE2) workbook', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]), 'SPREADSHEET_ENCRYPTED'],
    [
      'an oversized workbook part',
      buildArchive([packageRelationships('xl/workbook.xml'), { name: 'xl/workbook.xml', content: workbookXml(`<sheet name="${'x'.repeat(4_096)}"/>`) }]),
      'SPREADSHEET_ENTRY_TOO_LARGE',
    ],
  ])('tags %s with a stable error code', (_label, archive, code) => {
    let thrown: unknown
    try {
      readXlsxSheetNames(archive, 1_024)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code })
  })

  it('throws for input that is not a ZIP archive', () => {
    expect(() => readXlsxSheetNames(Buffer.from('not a zip archive'), maxBytes)).toThrow(
      'end of central directory record',
    )
  })

  it('throws when the package declares no workbook', () => {
    const archive = buildArchive([
      {
        name: '_rels/.rels',
        content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      },
    ])

    expect(() => readXlsxSheetNames(archive, maxBytes)).toThrow('no workbook relationship')
  })
})
