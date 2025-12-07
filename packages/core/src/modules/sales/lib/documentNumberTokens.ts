export type SalesDocumentNumberKind = 'quote' | 'order'

export const DEFAULT_ORDER_NUMBER_FORMAT = 'ORDER-{yyyy}{mm}{dd}-{seq:5}'
export const DEFAULT_QUOTE_NUMBER_FORMAT = 'QUOTE-{yyyy}{mm}{dd}-{seq:5}'

export const DOCUMENT_NUMBER_TOKENS: Array<{ token: string; description: string }> = [
  { token: '{yyyy}', description: '4-digit year, e.g. 2025' },
  { token: '{yy}', description: '2-digit year, e.g. 25' },
  { token: '{mm}', description: 'Month with leading zero, e.g. 04' },
  { token: '{dd}', description: 'Day with leading zero, e.g. 09' },
  { token: '{hh}', description: 'Hour in 24h format, e.g. 17' },
  {
    token: '{seq}',
    description: 'Sequence number scoped per organization and document type. Use {seq:5} to pad with zeros.',
  },
  {
    token: '{rand}',
    description: 'Random numeric block (default 4 digits). Use {rand:6} to control length.',
  },
  {
    token: '{nanoid}',
    description: 'Nano ID (default 12 chars). Use {nanoid:8} for a shorter version.',
  },
  { token: '{guid}', description: 'GUID / UUID v4' },
  { token: '{kind}', description: 'Document kind, e.g. order or quote' },
]
