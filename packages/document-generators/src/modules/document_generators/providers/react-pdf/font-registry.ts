import { Font } from '@react-pdf/renderer'
import { preferredFontFamilyName, resolveFontFamily } from '../../lib/font-sources'
import { withoutInternalPrefix } from '../../utils/withoutInternalPrefix'
import type { FontFamilyConfig, FontFamilyName } from '../../data/validators'
import type { ResolvedReactPdfConfig } from './config'
import { STANDARD_PDF_FONT_FAMILY } from './constants'

const PDF_FONT_REGISTRY_KEY = Symbol.for('@open-mercato/document-generators/pdf-font-registry')

type GlobalWithPdfFontRegistry = typeof globalThis & {
  [PDF_FONT_REGISTRY_KEY]?: PdfFontRegistry
}

export class PdfFontRegistry {
  private readonly registeredFamilies = new Set<string>()
  private pageFontFamily: FontFamilyName = STANDARD_PDF_FONT_FAMILY

  get fontFamily(): FontFamilyName {
    return this.pageFontFamily
  }

  applyConfig(config: ResolvedReactPdfConfig): FontFamilyName {
    for (const font of config.fonts) this.register(font)
    this.pageFontFamily = preferredFontFamilyName(config) ?? STANDARD_PDF_FONT_FAMILY
    return this.pageFontFamily
  }

  private register(font: FontFamilyConfig): void {
    if (this.registeredFamilies.has(font.family)) return
    try {
      Font.register(resolveFontFamily(font))
    } catch (error) {
      throw new Error(`[internal] Cannot register the "react-pdf" provider font "${font.family}": ${withoutInternalPrefix(error)}`, { cause: error })
    }
    this.registeredFamilies.add(font.family)
  }
}

export function getPdfFontRegistry(): PdfFontRegistry {
  const globalScope = globalThis as GlobalWithPdfFontRegistry
  if (!globalScope[PDF_FONT_REGISTRY_KEY]) globalScope[PDF_FONT_REGISTRY_KEY] = new PdfFontRegistry()
  return globalScope[PDF_FONT_REGISTRY_KEY]
}