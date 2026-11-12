import { absolutePositionToRelativePosition } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import {
  extractPositionedReviewBlocks,
  parseReviewDocument,
  type ReviewDocumentMapping,
} from './reviewContent'
import { createFindingQuoteLocator } from './findingQuoteLocator'
import { normalizeFindingText } from './findingTextNormalization'

export type FindingRelativeAnchor = {
  version: 2
  relativeFrom: string
  relativeTo: string
}

export type FindingAnchorResult =
  | { anchorStatus: 'located'; anchor: FindingRelativeAnchor; from: number; to: number }
  | { anchorStatus: 'unlocated'; anchor: null }

export type FindingAnchorRequest = {
  quote: string
  occurrence?: number
  sectionLabel?: string | null
}

export type FindingAnchorer = {
  locate: (request: FindingAnchorRequest) => FindingAnchorResult
  dispose: () => void
}

const UNLOCATED: FindingAnchorResult = { anchorStatus: 'unlocated', anchor: null }

export { normalizeFindingText }

function encodeRelativePosition(
  position: number,
  fragment: Y.XmlFragment,
  mapping: ReviewDocumentMapping,
): string {
  const relative = absolutePositionToRelativePosition(position, fragment, mapping)
  return Buffer.from(Y.encodeRelativePosition(relative)).toString('base64')
}

export function createFindingAnchorer(
  yjsState: Buffer | Uint8Array | null | undefined,
): FindingAnchorer {
  const parsed = parseReviewDocument(yjsState)
  if (!parsed) {
    return { locate: () => UNLOCATED, dispose: () => undefined }
  }
  const locateQuote = createFindingQuoteLocator(extractPositionedReviewBlocks(parsed.doc))
  return {
    locate(request) {
      const range = locateQuote(request)
      if (!range) return UNLOCATED
      const { from, to } = range
      return {
        anchorStatus: 'located',
        anchor: {
          version: 2,
          relativeFrom: encodeRelativePosition(from, parsed.fragment, parsed.mapping),
          relativeTo: encodeRelativePosition(to, parsed.fragment, parsed.mapping),
        },
        from,
        to,
      }
    },
    dispose() {
      parsed.ydoc.destroy()
    },
  }
}
