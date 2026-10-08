import type { FontFamilyName } from '../../../data/validators'
import { STANDARD_PDF_FONT_FAMILIES, STANDARD_PDF_FONT_UNSUPPORTED_CHARACTER } from '../constants'

export function usesStandardFontsOnly(fontFamily: FontFamilyName): boolean {
  const families = Array.isArray(fontFamily) ? fontFamily : [fontFamily]
  return families.every((family) => STANDARD_PDF_FONT_FAMILIES.has(family))
}

export function hasCharactersOutsideStandardFonts(data: unknown): boolean {
  return STANDARD_PDF_FONT_UNSUPPORTED_CHARACTER.test(JSON.stringify(data ?? null))
}
