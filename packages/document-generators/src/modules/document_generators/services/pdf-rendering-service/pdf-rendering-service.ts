import { createElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { DocumentRenderContext, DocumentRenderInput } from '../../lib/interfaces'
import type { ReactPdfTemplateSource } from './types'
import { getPdfFontRegistry } from '../../providers/react-pdf/font-registry'
import { resolveReactPdfConfig } from '../../providers/react-pdf/config'
import { hasCharactersOutsideStandardFonts, usesStandardFontsOnly } from '../../providers/react-pdf/utils/standardFonts'
import { withoutInternalPrefix } from '../../utils/withoutInternalPrefix'

const logger = createLogger('document_generators')
let unsupportedCharactersWarned = false

export class PdfRenderingService {
  async render(input: DocumentRenderInput, context: DocumentRenderContext) {
    if (input.format !== 'pdf' || input.source.type !== 'react-pdf' || typeof input.source.component !== 'function') {
      throw new Error('[internal] Invalid React-PDF document source')
    }
    const source = input.source as ReactPdfTemplateSource
    const fontFamily = getPdfFontRegistry().applyConfig(resolveReactPdfConfig(context.config))
    if (!unsupportedCharactersWarned && usesStandardFontsOnly(fontFamily) && hasCharactersOutsideStandardFonts(input.data)) {
      unsupportedCharactersWarned = true
      logger.warn('A PDF contains characters the built-in Helvetica font cannot render (for example Polish, Czech or Korean letters). Register a Unicode font in the "react-pdf" provider config (documentGeneratorsConfig.providers); see the document generators "Fonts" documentation.')
    }
    const element = createElement<DocumentProps & { data: Record<string, unknown> }>(source.component, { data: input.data })
    let buffer: Buffer
    try {
      buffer = await renderToBuffer(element)
    } catch (error) {
      if (usesStandardFontsOnly(fontFamily)) throw error
      const families = Array.isArray(fontFamily) ? fontFamily.join(', ') : fontFamily
      throw new Error(`[internal] PDF rendering failed with the "react-pdf" provider fonts ${families}; a variable or corrupted font file cannot be embedded: ${withoutInternalPrefix(error)}`, { cause: error })
    }
    return { buffer: new Uint8Array(buffer), format: 'pdf', mimeType: 'application/pdf' }
  }
}
