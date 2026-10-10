export const REACT_PDF_PROVIDER_ID = 'react-pdf'

export const STANDARD_PDF_FONT_FAMILY = 'Helvetica'

export const STANDARD_PDF_FONT_FAMILIES: ReadonlySet<string> = new Set(['Helvetica', 'Times-Roman', 'Courier', 'Symbol', 'ZapfDingbats'])

export const STANDARD_PDF_FONT_UNSUPPORTED_CHARACTER = /[^\t\n\r\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/u
