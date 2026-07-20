import type { GalleryEntry } from '../gallery/types'
import { galleryFamilies } from '../gallery/registry'
import { collectLeaves, type MockupDocument } from './schema'

/**
 * Registry-reference integrity — the CI gate that makes DS conformance
 * structural: every block must resolve to a shipped gallery entry (and
 * variant, when named), and sample props are only legal on entries exposing
 * `compose` (silent prop-dropping would lie to reviewers).
 *
 * Pure data walk, no fs — the unit test feeds it committed documents, the
 * annotation write path re-runs it before touching disk.
 */

export type MockupIntegrityIssue = {
  blockId: string
  message: string
}

export async function loadGalleryEntryMap(): Promise<Map<string, GalleryEntry>> {
  const entries = new Map<string, GalleryEntry>()
  for (const family of galleryFamilies) {
    const mod = await family.load()
    for (const entry of mod.entries) entries.set(entry.id, entry)
  }
  return entries
}

export function checkMockupIntegrity(
  document: MockupDocument,
  entries: Map<string, GalleryEntry>,
): MockupIntegrityIssue[] {
  const issues: MockupIntegrityIssue[] = []
  for (const leaf of collectLeaves(document.root)) {
    if (leaf.type !== 'block') continue
    const entry = entries.get(leaf.entry)
    if (!entry) {
      issues.push({
        blockId: leaf.id,
        message: `Block "${leaf.id}" references unknown gallery entry "${leaf.entry}"`,
      })
      continue
    }
    if (leaf.variant !== undefined && !entry.variants.some((variant) => variant.id === leaf.variant)) {
      issues.push({
        blockId: leaf.id,
        message: `Block "${leaf.id}" references unknown variant "${leaf.variant}" of entry "${leaf.entry}"`,
      })
    }
    if (leaf.props !== undefined) {
      if (typeof entry.compose !== 'function') {
        issues.push({
          blockId: leaf.id,
          message: `Block "${leaf.id}" supplies props but entry "${leaf.entry}" exposes no compose() — props would be silently dropped`,
        })
      } else if (entry.composePropsSchema) {
        const parsed = entry.composePropsSchema.safeParse(leaf.props)
        if (!parsed.success) {
          const detail = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')
          issues.push({
            blockId: leaf.id,
            message: `Block "${leaf.id}" props fail composePropsSchema of entry "${leaf.entry}" — ${detail}`,
          })
        }
      }
    }
  }
  return issues
}
