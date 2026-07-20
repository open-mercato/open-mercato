import type { SectionNavGroup } from '@open-mercato/ui/backend/section-page'
import { GALLERY_BASE_PATH, galleryFamilies } from '../registry'

/** Route of the mockup list page — a secondary tab of the Design system section. */
export const MOCKUPS_BASE_PATH = `${GALLERY_BASE_PATH}/mockups`

/** 'buttons' → 'Buttons' — untranslated fallback when a family labelKey has no message. */
export function familyLabelFallback(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

/**
 * Shared SectionNav groups for every Design system page: the gallery families
 * plus the mockup composer tab (spec 2026-07-05-ds-live-mockup-composer.md —
 * the mockup list hangs off the existing Design system nav entry, not a new
 * top-level nav item).
 */
export function buildDesignSystemSections(): SectionNavGroup[] {
  return [
    {
      id: 'families',
      label: 'Families',
      labelKey: 'design_system.gallery.familiesGroup',
      items: galleryFamilies.map((family) => ({
        id: family.id,
        label: familyLabelFallback(family.id),
        labelKey: family.labelKey,
        href: `${GALLERY_BASE_PATH}?family=${family.id}`,
      })),
    },
    {
      id: 'mockups',
      label: 'Mockups',
      labelKey: 'design_system.mockups.navGroup',
      items: [
        {
          id: 'mockups',
          label: 'Screen mockups',
          labelKey: 'design_system.mockups.navItem',
          href: MOCKUPS_BASE_PATH,
        },
      ],
    },
  ]
}
