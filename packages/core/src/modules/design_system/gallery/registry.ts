import type { GalleryFamily } from './types'

/** The DS Figma file id — every `figmaNodeId` in gallery entries points into this file. */
export const DS_FIGMA_FILE = 'qCq9z6q1if0mpoRstV5OEA'

/** Base of the deep links into the monorepo DS docs (`.ai/ui-components.md`). */
export const DS_DOCS_URL = 'https://github.com/open-mercato/open-mercato/blob/main/.ai/ui-components.md'

/** Route of the gallery backend page; used for section-nav hrefs and deep links. */
export const GALLERY_BASE_PATH = '/backend/design-system'

/** Builds a Figma deep link for a `nodeId` in `<page>:<node>` format. */
export function figmaNodeUrl(nodeId: string): string {
  return `https://www.figma.com/design/${DS_FIGMA_FILE}/?node-id=${nodeId.replace(':', '-')}`
}

/**
 * Family manifest. Each family's entries live in `entries/<family>.tsx` and are
 * loaded lazily via a dynamic import so a family's primitives (and their
 * dependencies) only load when its section is opened.
 *
 * Adding a family: add the manifest row here and create `entries/<id>.tsx`
 * exporting `entries: GalleryEntry[]`. The coverage-guard test
 * (`__tests__/gallery-coverage.test.ts`) will tell you which primitives the
 * new file must cover.
 */
export const galleryFamilies: GalleryFamily[] = [
  {
    id: 'buttons',
    labelKey: 'design_system.families.buttons',
    load: () => import('./entries/buttons'),
  },
  {
    id: 'inputs',
    labelKey: 'design_system.families.inputs',
    load: () => import('./entries/inputs'),
  },
  {
    id: 'dates',
    labelKey: 'design_system.families.dates',
    load: () => import('./entries/dates'),
  },
  {
    id: 'feedback',
    labelKey: 'design_system.families.feedback',
    load: () => import('./entries/feedback'),
  },
  {
    id: 'overlays',
    labelKey: 'design_system.families.overlays',
    load: () => import('./entries/overlays'),
  },
  {
    id: 'navigation',
    labelKey: 'design_system.families.navigation',
    load: () => import('./entries/navigation'),
  },
  {
    id: 'display',
    labelKey: 'design_system.families.display',
    load: () => import('./entries/display'),
  },
  {
    id: 'charts',
    labelKey: 'design_system.families.charts',
    load: () => import('./entries/charts'),
  },
  {
    id: 'filters',
    labelKey: 'design_system.families.filters',
    load: () => import('./entries/filters'),
  },
  {
    id: 'detail',
    labelKey: 'design_system.families.detail',
    load: () => import('./entries/detail'),
  },
  {
    id: 'scaffolding',
    labelKey: 'design_system.families.scaffolding',
    load: () => import('./entries/scaffolding'),
  },
  {
    id: 'banners',
    labelKey: 'design_system.families.banners',
    load: () => import('./entries/banners'),
  },
  {
    id: 'notifications',
    labelKey: 'design_system.families.notifications',
    load: () => import('./entries/notifications'),
  },
  {
    id: 'schedule',
    labelKey: 'design_system.families.schedule',
    load: () => import('./entries/schedule'),
  },
  {
    id: 'messages',
    labelKey: 'design_system.families.messages',
    load: () => import('./entries/messages'),
  },
]
