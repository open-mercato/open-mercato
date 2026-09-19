import { withProfile, type DisplayProfile, type PaperSizeCode } from './profile'

export type PaperSizeDescriptor = {
  code: PaperSizeCode
  /** The value an `@page { size: ... }` rule and puppeteer's `format` option both accept. */
  css: 'A4' | 'Letter' | 'Legal'
  widthPt: number
  heightPt: number
}

const PAPER_SIZES: Record<PaperSizeCode, PaperSizeDescriptor> = {
  a4: { code: 'a4', css: 'A4', widthPt: 595.28, heightPt: 841.89 },
  letter: { code: 'letter', css: 'Letter', widthPt: 612, heightPt: 792 },
  legal: { code: 'legal', css: 'Legal', widthPt: 612, heightPt: 1008 },
}

/** The market's page size for generated documents. */
export function paperSize(profile?: DisplayProfile | null): PaperSizeDescriptor {
  return PAPER_SIZES[withProfile(profile).paperSize] ?? PAPER_SIZES.a4
}
