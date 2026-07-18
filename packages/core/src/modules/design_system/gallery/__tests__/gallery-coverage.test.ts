import fs from 'node:fs'
import path from 'node:path'
import { galleryFamilies } from '../registry'

/**
 * Coverage guard — the mechanism that keeps the gallery living.
 *
 * Every file in `packages/ui/src/primitives` must either have a gallery entry
 * (matched via the entry's `importPath`) or an explicit allowlist reason
 * below. A new primitive without either fails CI.
 */

// Files that are not standalone visual components and will never get an entry.
const NON_COMPONENT: Record<string, string> = {
  'date-format.ts': 'Date formatting helpers, no visual component.',
  'date-picker-helpers.ts': 'Shared date-picker parsing/formatting helpers, no visual component.',
  'label.tsx': 'Form label sub-primitive shown through FormField/inputs, not a standalone entry.',
  'notification-stack.tsx': 'Imperative stacking host for notification primitives, no standalone visual.',
}

// Primitives whose families are not seeded yet (Phase 2 ships only `buttons`).
// This list MUST shrink as families land in follow-up PRs (Phase 3 of the
// spec) — remove each file here in the same PR that adds its gallery entry.
const PENDING_FAMILIES: Record<string, string> = {
  'DataLoader.tsx': 'Pending feedback family.',
  'ErrorNotice.tsx': 'Pending feedback family.',
  'Notice.tsx': 'Pending feedback family.',
  'accordion.tsx': 'Pending navigation family.',
  'activity-feed.tsx': 'Pending display family.',
  'alert.tsx': 'Pending feedback family.',
  'amount-input.tsx': 'Pending inputs family.',
  'avatar.tsx': 'Pending display family.',
  'badge.tsx': 'Pending display family.',
  'breadcrumb.tsx': 'Pending navigation family.',
  'button-input.tsx': 'Pending inputs family.',
  'calendar.tsx': 'Pending dates family.',
  'card-input.tsx': 'Pending inputs family.',
  'card.tsx': 'Pending display family.',
  'checkbox-field.tsx': 'Pending inputs family.',
  'checkbox.tsx': 'Pending inputs family.',
  'color-picker.tsx': 'Pending inputs family.',
  'command-menu.tsx': 'Pending overlays family.',
  'compact-select.tsx': 'Pending inputs family.',
  'counter-input.tsx': 'Pending inputs family.',
  'date-picker.tsx': 'Pending dates family.',
  'date-range-picker.tsx': 'Pending dates family.',
  'dialog.tsx': 'Pending overlays family.',
  'digit-input.tsx': 'Pending inputs family.',
  'drawer.tsx': 'Pending overlays family.',
  'email-input.tsx': 'Pending inputs family.',
  'empty-state.tsx': 'Pending feedback family.',
  'form-field.tsx': 'Pending inputs family.',
  'inline-input.tsx': 'Pending inputs family.',
  'inline-select.tsx': 'Pending inputs family.',
  'input.tsx': 'Pending inputs family.',
  'kbd.tsx': 'Pending display family.',
  'notification-feed.tsx': 'Pending feedback family.',
  'notification.tsx': 'Pending feedback family.',
  'pagination.tsx': 'Pending navigation family.',
  'password-input.tsx': 'Pending inputs family.',
  'popover.tsx': 'Pending overlays family.',
  'progress.tsx': 'Pending feedback family.',
  'radio-field.tsx': 'Pending inputs family.',
  'radio.tsx': 'Pending inputs family.',
  'rating.tsx': 'Pending feedback family.',
  'rich-editor.tsx': 'Pending inputs family.',
  'scroll-area.tsx': 'Pending display family.',
  'search-input.tsx': 'Pending inputs family.',
  'segmented-control.tsx': 'Pending navigation family.',
  'select.tsx': 'Pending inputs family.',
  'separator.tsx': 'Pending display family.',
  'sheet.tsx': 'Pending overlays family.',
  'skeleton.tsx': 'Pending feedback family.',
  'slider.tsx': 'Pending inputs family.',
  'spinner.tsx': 'Pending feedback family.',
  'status-badge.tsx': 'Pending display family.',
  'step-indicator.tsx': 'Pending feedback family.',
  'switch-field.tsx': 'Pending inputs family.',
  'switch.tsx': 'Pending inputs family.',
  'table.tsx': 'Pending display family.',
  'tabs.tsx': 'Pending navigation family.',
  'tag-input.tsx': 'Pending inputs family.',
  'tag.tsx': 'Pending display family.',
  'textarea.tsx': 'Pending inputs family.',
  'time-picker.tsx': 'Pending dates family.',
  'tooltip.tsx': 'Pending overlays family.',
  'website-input.tsx': 'Pending inputs family.',
}

const PRIMITIVES_DIR = path.resolve(__dirname, '../../../../../..', 'ui/src/primitives')

function listPrimitiveFiles(): string[] {
  return fs
    .readdirSync(PRIMITIVES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && /\.(ts|tsx)$/.test(dirent.name))
    .map((dirent) => dirent.name)
    .sort()
}

async function coveredPrimitiveFiles(): Promise<Set<string>> {
  const covered = new Set<string>()
  const modules = await Promise.all(galleryFamilies.map((family) => family.load()))
  for (const mod of modules) {
    for (const entry of mod.entries) {
      const match = entry.importPath.match(/^@open-mercato\/ui\/primitives\/(.+)$/)
      if (match) covered.add(`${match[1]}.tsx`)
    }
  }
  return covered
}

describe('design_system gallery coverage guard', () => {
  it('accounts for every file in packages/ui/src/primitives', async () => {
    const covered = await coveredPrimitiveFiles()
    const missing = listPrimitiveFiles().filter(
      (file) => !covered.has(file) && !(file in NON_COMPONENT) && !(file in PENDING_FAMILIES),
    )
    // A non-empty diff here means a primitive landed without a gallery entry:
    // add the entry (preferred) or an allowlist row with a one-line reason.
    expect(missing).toEqual([])
  })

  it('keeps the allowlists honest (no stale or already-covered files)', async () => {
    const covered = await coveredPrimitiveFiles()
    const files = new Set(listPrimitiveFiles())
    const allowlisted = [...Object.keys(NON_COMPONENT), ...Object.keys(PENDING_FAMILIES)]

    const stale = allowlisted.filter((file) => !files.has(file))
    expect(stale).toEqual([])

    const alreadyCovered = allowlisted.filter((file) => covered.has(file))
    expect(alreadyCovered).toEqual([])

    const doubleListed = Object.keys(NON_COMPONENT).filter((file) => file in PENDING_FAMILIES)
    expect(doubleListed).toEqual([])
  })
})
