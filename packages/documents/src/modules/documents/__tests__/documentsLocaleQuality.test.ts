import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import pl from '../i18n/pl.json'

type Catalog = Record<string, string>

const catalogs: Record<string, Catalog> = { de, es, pl }
const allowedIdenticalValues: Record<string, string[]> = {
  de: [
    'documents.editor.colors.orange',
    'documents.editor.link.placeholder',
    'documents.editor.realtime.connected',
    'documents.editor.toolbar.link',
    'documents.entityFields.name',
    'documents.entityFields.sku',
    'documents.entityFields.status',
    'documents.export.docx',
    'documents.export.pdf',
    'documents.templates.columns.name',
    'documents.templates.fields.name',
  ],
  es: [
    'documents.editor.link.placeholder',
    'documents.entityFields.sku',
    'documents.entityFields.total',
    'documents.export.docx',
    'documents.export.pdf',
    'documents.permissions.editor',
    'documents.templates.compatible',
  ],
  pl: [
    'documents.columns.folder',
    'documents.editor.link.placeholder',
    'documents.entityFields.sku',
    'documents.entityFields.status',
    'documents.export.docx',
    'documents.export.pdf',
  ],
}

const representativeChrome = [
  'documents.actions.backToList',
  'documents.editor.toolbar.bold',
  'documents.folders.empty',
  'documents.list.error.load',
  'documents.share.dialog.title',
  'documents.validation.title.required',
]

const apiErrorKeys = [
  'documents.errors.organizationRequired',
  'documents.errors.recordChanged',
  'documents.documents.notFound',
  'documents.folders.notFound',
  'documents.share.notFound',
  'documents.share.principalNotFound',
  'documents.comments.notFound',
  'documents.attachments.partitionUnavailable',
  'documents.attachments.multipartRequired',
  'documents.attachments.fileRequired',
  'documents.attachments.tooLarge',
  'documents.attachments.executableBlocked',
  'documents.attachments.activeContentBlocked',
  'documents.attachments.quotaExceeded',
  'documents.attachments.notFound',
  'documents.attachments.partitionMisconfigured',
  'documents.attachments.fileUnavailable',
  'documents.export.runtimeUnavailable',
  'documents.export.unsupportedFormat',
]

const representativeApiErrors = [
  'documents.errors.organizationRequired',
  'documents.errors.recordChanged',
  'documents.share.principalNotFound',
  'documents.attachments.quotaExceeded',
  'documents.export.runtimeUnavailable',
  'documents.export.unsupportedFormat',
]

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(([token]) => token).sort()
}

describe('Documents locale quality', () => {
  it.each(Object.entries(catalogs))('%s has the same key shape as English', (_locale, catalog) => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort())
  })

  it.each(Object.entries(catalogs))('%s does not fall back to English for representative chrome', (_locale, catalog) => {
    for (const key of representativeChrome) expect(catalog[key]).not.toBe(en[key])
  })

  it.each(Object.entries(catalogs))('%s localizes representative API errors', (_locale, catalog) => {
    for (const key of representativeApiErrors) expect(catalog[key]).not.toBe(en[key])
  })

  it.each(Object.entries(catalogs))('%s preserves API-error terminal punctuation', (_locale, catalog) => {
    for (const key of apiErrorKeys) expect(catalog[key].endsWith('.')).toBe(en[key].endsWith('.'))
  })

  it.each(Object.entries(catalogs))('%s preserves every interpolation placeholder', (_locale, catalog) => {
    for (const key of Object.keys(en)) expect(placeholders(catalog[key])).toEqual(placeholders(en[key]))
  })

  it.each(Object.entries(catalogs))('%s only shares intentional technical or localized values with English', (locale, catalog) => {
    const identicalKeys = Object.keys(en).filter((key) => catalog[key] === en[key]).sort()
    expect(identicalKeys).toEqual(allowedIdenticalValues[locale].toSorted())
  })
})
