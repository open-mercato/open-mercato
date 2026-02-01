# Sidebar Reorganization Specification

## Overview

This specification describes the reorganization of the backend admin panel sidebar to improve user experience by reducing clutter and minimizing the need for constant scrolling. The main proposal is to move Configuration, Workflows, and other admin/system modules out of the main sidebar and into a dedicated **Settings page** with its own internal vertical-tab navigation — following the Apple iPad Settings / Attio Settings pattern.

The approach is generalized: the same "section page with internal navigation" pattern is reusable for other top-level sections like **Profile**.

**Status:** Proposed
**Priority:** Medium (UX improvement)
**Package Location:** `packages/ui/src/backend/AppShell.tsx`, various module `*.meta.ts` files
**Benchmarks:** Apple iPad Settings, Attio Settings (see screenshot)

---

## Problem Statement

### Current Issues

1. **Sidebar Overload**: The current sidebar contains too many top-level navigation groups, requiring users to scroll extensively to access different sections.

2. **Poor Discoverability**: Configuration and system settings are mixed with business-oriented modules, making it harder for users to find what they need.

3. **Context Switching**: Users managing system configuration must navigate through business modules, creating unnecessary cognitive load.

### Current Sidebar Groups (alphabetically)

| Group | Module | Items Count | User Type |
|-------|--------|-------------|-----------|
| Auth | auth | 2-4 | Admin |
| Business Rules | business_rules | 3 | Power User |
| Catalog | catalog | 2 | Business User |
| Configuration | configs, sales, catalog, customers, currencies, dictionaries, entities, planner | 8+ | Admin |
| Currencies | currencies | 2 | Business User |
| Customers | customers | 4 | Business User |
| Data designer | entities, query_index | 3 | Admin/Developer |
| Directory | directory | 2 | Admin |
| Employees | staff | 8 | Business User |
| Feature Toggles | feature_toggles | 2 | Admin |
| Resource planning | resources | 2 | Business User |
| Sales | sales | 5 | Business User |
| Workflows | workflows | 4 | Power User/Admin |

**Total Groups**: 13+
**Typical Visible Items**: Only 8-10 items visible without scrolling (depending on viewport)

---

## Proposed Solution

### Strategy: Settings as a Dedicated Page with Internal Navigation

Instead of a complex three-tier sidebar or a profile dropdown menu, we use a simple and scalable approach:

1. The **main sidebar** stays lean — only business operation modules.
2. **Settings** is accessible from two places: a pinned entry at the bottom of the sidebar **and** a gear icon in the top bar. Both open the same full-page settings experience.
3. **Profile** is accessible **only from the top bar** (user avatar/icon) — not from the sidebar.
4. Both Settings and Profile pages replace the main sidebar with their own **vertical-tab internal navigation** (like Apple iPad Settings or Attio Settings).
5. The pattern is **generic** and reusable for other top-level sections.

### New Navigation Architecture

#### Main Sidebar (Business Operations)

```
┌──────────────────────────┐
│  Dashboard               │
│  Customers               │
│  Catalog                 │
│  Sales                   │
│  Currencies              │
│  Employees               │
│  Resource planning       │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Settings            ->  │
└──────────────────────────┘

Top bar (right side):
Current:  [🌗] [Q Search ⌘K] [Organization] [Acme Corp v] [Manage] [👤] [🔔]
Proposed: [🌗] [Q Search ⌘K] [Acme Corp v] [⚙] [👤] [🔔]

  Removed: "Organization" label and "Manage" link (saves horizontal space)
  Added:   ⚙ gear icon for Settings
  Note:    "Manage" (/backend/directory/organizations) moves to Settings > Directory
  ⚙ = Settings shortcut (opens /backend/settings)
  👤 = User avatar — opens dropdown (see below)

User avatar dropdown (existing pattern, updated links):
┌────────────────────────────────┐
│ Logged in as:                  │
│ admin@acme.com                 │
├────────────────────────────────┤
│ Change password                │→ /backend/profile/change-password
│ Preferences                   │→ /backend/profile/preferences
├────────────────────────────────┤
│ Logout                         │
└────────────────────────────────┘
```

- Business groups occupy the main area.
- **Settings** is pinned at the bottom of the sidebar (separated by a divider) **and** accessible via a gear icon in the top bar.
- **Profile** is accessed from the existing **user avatar dropdown** in the top bar. The dropdown items are **deep links** into the Profile section page — e.g., clicking "Change password" opens `/backend/profile/change-password` with the Profile internal navigation loaded and "Change Password" selected in the left panel. It does not appear in the sidebar.
- Clicking Settings or any Profile dropdown item navigates to a full-page experience with its own internal navigation.

#### Settings Page (Internal Navigation)

When the user clicks "Settings", the main sidebar is replaced by the Settings internal navigation. This follows the Apple iPad Settings / Attio Settings pattern — a vertical list of sections on the left, content on the right.

```
┌──────────────────────────┬────────────────────────────────────────┐
│  < Settings              │                                        │
│  ────────────────────    │  Cache                                 │
│  System                  │  ─────────────────────────────────     │
│    System Status         │                                        │
│    Cache            [*]  │  Manage cache strategies and           │
│  ────────────────────    │  invalidation rules.                   │
│  Auth                    │                                        │
│    Users                 │  [ Clear All Cache ]                   │
│    Roles                 │                                        │
│    API Keys              │  Strategy: Redis                       │
│  ────────────────────    │  Hit Rate: 94.2%                       │
│  Business Rules          │  ...                                   │
│    Rules                 │                                        │
│    Sets                  │                                        │
│    Logs                  │                                        │
│  ────────────────────    │                                        │
│  Data Designer           │                                        │
│    System Entities       │                                        │
│    User Entities         │                                        │
│    Query Indexes         │                                        │
│  ────────────────────    │                                        │
│  Workflows               │                                        │
│    Definitions           │                                        │
│    Instances             │                                        │
│    Tasks                 │                                        │
│    Events                │                                        │
│  ────────────────────    │                                        │
│  Module Configs          │                                        │
│    Sales                 │                                        │
│    Catalog               │                                        │
│    Customers             │                                        │
│    Currencies            │                                        │
│    Dictionaries          │                                        │
│    Encryption            │                                        │
│  ────────────────────    │                                        │
│  Directory               │                                        │
│    Organizations         │                                        │
│    Tenants               │                                        │
│  ────────────────────    │                                        │
│  Feature Toggles         │                                        │
│    Global                │                                        │
│    Overrides             │                                        │
└──────────────────────────┴────────────────────────────────────────┘
```

Key elements:
- **"< Settings"** back link at the top returns to the main app (restores the main sidebar).
- Grouped sections with labels act as vertical tabs.
- The currently selected item is highlighted (e.g., `[*]` above).
- The right panel renders the content of the selected settings page.
- Sections are **auto-discovered from module metadata** — modules register their pages into Settings via `pageContext`.

#### Profile Page (Internal Navigation)

The same pattern is reused for the Profile section:

```
┌──────────────────────────┬────────────────────────────────────────┐
│  < Profile               │                                        │
│  ────────────────────    │  Change Password                       │
│  Account                 │  ─────────────────────────────────     │
│    Change Password  [*]  │                                        │
│    Preferences           │  Current Password: [__________]        │
│  ────────────────────    │  New Password:     [__________]        │
│  Notifications           │  Confirm:          [__________]        │
│    Preferences           │                                        │
│                          │  [ Update Password ]                   │
│                          │                                        │
└──────────────────────────┴────────────────────────────────────────┘
```

Currently, Profile only has "Change Password", but this pattern makes it easy to add more pages (Preferences, Notification Settings, etc.) over time.

### Navigation Grouping

#### Main Sidebar (Business Operations)

Primary day-to-day business activities. Should be visible without scrolling.

| Group | Contents | Target User |
|-------|----------|-------------|
| Dashboard | Home/Dashboard | All |
| Customers | People, Companies, Deals, Pipeline | Sales/Support |
| Catalog | Products, Categories | Product Team |
| Sales | Orders, Quotes, Channels, Documents | Sales |
| Currencies | Currencies, Exchange Rates | Finance |
| Employees | Teams, Members, Leave Requests, Availability | HR/Managers |
| Resource planning | Resources, Resource Types | Operations |

#### Settings Page Sections

Administrative, configuration, and system-level tools. Accessed from the "Settings" entry in the sidebar.

| Section | Contents | Target User |
|---------|----------|-------------|
| System | System Status, Cache | Admin |
| Auth | Users, Roles, API Keys | Admin |
| Business Rules | Rules, Sets, Logs | Power User |
| Data Designer | System/User Entities, Query Indexes | Developer |
| Workflows | Definitions, Instances, Tasks, Events | Power User |
| Module Configs | Sales, Catalog, Customers, Currencies, Dictionaries, Encryption | Admin |
| Directory | Organizations, Tenants | Super Admin |
| Feature Toggles | Global, Overrides | Admin |

#### Profile Page Sections

User-specific settings. Accessed from the "Profile" entry in the sidebar.

| Section | Contents | Target User |
|---------|----------|-------------|
| Account | Change Password, Preferences | All |
| Notifications | Notification Preferences | All |

---

## Implementation Approach

### Phase 1: Generic Section Page Component

Create a reusable `SectionPage` layout component that renders vertical-tab navigation on the left and content on the right. This is the foundation for both Settings and Profile pages.

#### SectionPage Component

```typescript
// packages/ui/src/backend/section-page/SectionPage.tsx
type SectionPageProps = {
  /** Back link label, e.g. "Settings" or "Profile" */
  backLabel: string
  /** Route to navigate back to (main app) */
  backHref: string
  /** Navigation sections (auto-discovered from page metadata) */
  sections: SectionNavGroup[]
  /** Currently active page path */
  activePath: string
  children: React.ReactNode
}

type SectionNavGroup = {
  id: string
  label: string
  labelKey?: string
  items: SectionNavItem[]
}

type SectionNavItem = {
  id: string
  label: string
  labelKey?: string
  href: string
  icon?: string
  requireFeatures?: string[]
}

export function SectionPage({ backLabel, backHref, sections, activePath, children }: SectionPageProps) {
  return (
    <div className="flex h-full">
      {/* Left: vertical tab navigation */}
      <nav className="w-64 border-r overflow-y-auto">
        <Link href={backHref} className="flex items-center gap-2 p-4">
          <ChevronLeft /> {backLabel}
        </Link>
        {sections.map(section => (
          <SectionNavGroupComponent
            key={section.id}
            section={section}
            activePath={activePath}
          />
        ))}
      </nav>
      {/* Right: page content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
```

### Phase 2: Page Metadata — `pageContext` and `placement`

Modules dynamically register their pages into the appropriate section page using the `pageContext` field in page metadata. This field replaces the old approach of showing everything in the main sidebar.

#### `pageContext` Field

```typescript
type PageMetadata = {
  // ... existing fields ...

  /**
   * Controls where this page appears in navigation.
   * - 'main' (default): Main sidebar
   * - 'settings': Settings section page (vertical tabs)
   * - 'profile': Profile section page (vertical tabs)
   * Any string value is supported — new section pages can be defined by modules.
   */
  pageContext?: string

  /**
   * Controls placement within the section page.
   * Specifies which group/subsection this page belongs to.
   * Format: '<sectionId>' or '<sectionId>/<subSectionId>'
   */
  placement?: {
    /** The section group this page belongs to (e.g., 'system', 'auth', 'module-configs') */
    section: string
    /** Display label for the section group */
    sectionLabel?: string
    /** i18n key for the section label */
    sectionLabelKey?: string
    /** Order within the section */
    order?: number
  }
}
```

#### Example: Moving System Status to Settings

```typescript
// packages/core/src/modules/configs/backend/config/system-status/page.meta.ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.system_status.view'],
  pageTitle: 'System status',
  pageTitleKey: 'configs.config.nav.systemStatus',
  pageGroup: 'System',
  pageGroupKey: 'backend.nav.system',
  pageOrder: 120,
  icon: heartbeatIcon,
  // NEW: Place in Settings section page, under "System" group
  pageContext: 'settings',
  placement: {
    section: 'system',
    sectionLabelKey: 'settings.sections.system',
    order: 1,
  },
}
```

#### Example: Moving Change Password to Profile

```typescript
// packages/core/src/modules/auth/backend/auth/change-password/page.meta.ts
export const metadata = {
  requireAuth: true,
  pageTitle: 'Change Password',
  pageTitleKey: 'auth.changePassword.title',
  pageContext: 'profile',
  placement: {
    section: 'account',
    sectionLabelKey: 'profile.sections.account',
    order: 1,
  },
}
```

#### Dynamic Module Registration

Any module can add pages to Settings (or Profile, or any section page) by simply setting `pageContext` and `placement` in its page metadata. No hardcoded registration is needed.

```typescript
// Example: A custom module adding a settings page
// apps/mercato/src/modules/my_module/backend/settings/page.meta.ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['my_module.manage'],
  pageTitle: 'My Module Config',
  pageTitleKey: 'my_module.settings.title',
  pageContext: 'settings',
  placement: {
    section: 'module-configs',
    sectionLabelKey: 'settings.sections.moduleConfigs',
    order: 50,
  },
}
```

### Phase 3: Update AppShell and Navigation Utilities

#### AppShell Changes

The AppShell needs to:
1. Filter `pageContext: 'main'` (or undefined) groups for the main sidebar.
2. Add a "Settings" entry pinned at the bottom of the sidebar.
3. Add a gear icon (Settings) and user avatar icon (Profile) to the top bar.
4. When on a settings/profile page, render the `SectionPage` layout instead of the regular sidebar.

```typescript
// packages/ui/src/backend/AppShell.tsx
export type AppShellProps = {
  // ... existing props
  groups: NavGroup[]
  /** Section pages discovered from module metadata */
  sectionPages?: SectionPageConfig[]
}

type SectionPageConfig = {
  /** Unique id matching pageContext values (e.g., 'settings', 'profile') */
  id: string
  label: string
  labelKey?: string
  icon: string
  href: string
  /** Sections auto-built from page metadata with matching pageContext */
  sections: SectionNavGroup[]
}
```

#### Navigation Utility Updates

```typescript
// packages/ui/src/backend/utils/nav.ts

/**
 * Groups pages by their pageContext and placement into SectionPageConfig objects.
 * Pages with pageContext='main' or no pageContext go to the main sidebar.
 * Pages with other pageContext values are grouped into section pages.
 */
export function buildSectionPages(allPages: PageMetadataEntry[]): {
  mainGroups: NavGroup[]
  sectionPages: SectionPageConfig[]
}
```

### Phase 4: Section Page Routes

#### Settings Route

```typescript
// packages/core/src/modules/configs/backend/settings/page.tsx
import { SectionPage } from '@open-mercato/ui/backend/section-page/SectionPage'

export default function SettingsPage({ sections, activePath, children }) {
  return (
    <SectionPage
      backLabel="Settings"
      backHref="/backend"
      sections={sections}
      activePath={activePath}
    >
      {children}
    </SectionPage>
  )
}
```

#### Profile Route

```typescript
// packages/core/src/modules/auth/backend/profile/page.tsx
import { SectionPage } from '@open-mercato/ui/backend/section-page/SectionPage'

export default function ProfilePage({ sections, activePath, children }) {
  return (
    <SectionPage
      backLabel="Profile"
      backHref="/backend"
      sections={sections}
      activePath={activePath}
    >
      {children}
    </SectionPage>
  )
}
```

---

## UI/UX Guidelines

### Main Sidebar Behavior

1. **Business groups**: Always visible, no collapse needed (the sidebar is now short enough).
2. **Bottom-pinned "Settings"**: A "Settings" entry is pinned at the bottom of the sidebar (separated by a divider), always visible.
3. **Active state**: When the user is inside Settings, the sidebar entry is highlighted.

### Top Bar Behavior

1. **Gear icon (Settings)**: A gear/cog icon in the top-right area of the top bar opens `/backend/settings`. This is a shortcut — the same destination as the sidebar "Settings" entry.
2. **User avatar dropdown (Profile)**: The existing user avatar dropdown remains, but its items now **deep-link into the Profile section page** instead of navigating to standalone pages. For example, "Change password" links to `/backend/profile/change-password`, which opens the Profile section page with the internal navigation loaded and "Change Password" pre-selected in the left panel. "Logout" stays as a direct action (no section page needed).
3. **Active state**: When inside Profile, the user avatar is highlighted.

### Section Page Behavior

1. **Back navigation**: The "< Settings" (or "< Profile") link at the top-left returns to the main app and restores the main sidebar.
2. **Vertical tabs**: The left panel lists grouped sections. Clicking an item loads its content in the right panel.
3. **Highlight**: The currently active item is visually highlighted.
4. **Scrollable**: The left navigation scrolls independently if there are many sections.
5. **Responsive**: On smaller viewports, the section navigation can collapse into a hamburger or slide-out panel.
6. **Deep linking**: Direct URLs (e.g., `/backend/settings/cache`) select the correct item in the left navigation and render its content.

### Sidebar Customization Scope

The existing sidebar customization system (custom labels, group reordering, item hiding, role-based presets via `SidebarPreferencesSettings`) applies **only to the main sidebar** — the top-level business navigation. It is **not** extended to the internal navigation of section pages (Settings, Profile, etc.).

Rationale:
- The main sidebar is the user's primary workspace — customizing it has high value (different roles focus on different modules).
- Settings/Profile internal navigation is a system-defined structure. Its layout is determined by which modules are installed and their `pageContext`/`placement` metadata. Users should not need to customize it — it is already filtered by ACL features (items the user can't access are hidden automatically).
- Keeping customization at the top level avoids complexity: `SidebarPreferencesSettings` stores `groupOrder`, `groupLabels`, `itemLabels`, and `hiddenItems` keyed by group IDs and item hrefs. These keys reference main sidebar items only. No changes to the existing data model or API are needed.

Summary:
| Area | Customizable? | Custom labels | Reorder | Hide items | Role presets |
|------|--------------|---------------|---------|------------|--------------|
| Main sidebar | Yes | Yes | Yes | Yes | Yes |
| Settings internal nav | No | No | No | No (ACL-driven) | No |
| Profile internal nav | No | No | No | No (ACL-driven) | No |

### Visual Design

- The section page left panel replaces the main sidebar — it occupies the same visual space, preserving layout consistency.
- Section group labels are styled as subtle headers/dividers (not clickable).
- Individual items have icons, labels, and optional badges.
- The right content area uses the same page layout components as regular pages.

---

## Migration Path

### Step 1: Non-breaking Foundation
1. Add `pageContext` and `placement` fields to page metadata types (optional, defaults to `'main'`).
2. Create the `SectionPage` reusable component.
3. Create the Settings and Profile route pages.
4. Add "Settings" entry to the sidebar bottom and gear/avatar icons to the top bar.

### Step 2: Migrate Pages to Settings
1. Update metadata for configs, workflows, entities, query_index, auth, directory, business_rules, and feature_toggles modules.
2. Set `pageContext: 'settings'` and appropriate `placement` values.
3. Move Change Password to `pageContext: 'profile'`.

### Step 3: Cleanup and Polish
1. Remove empty groups from the main sidebar.
2. Update breadcrumbs to reflect the new hierarchy.
3. Ensure deep links and bookmarks continue to work.

---

## Affected Files

### Core Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/ui/src/backend/AppShell.tsx` | Modify | Support section pages, add bottom-pinned entries |
| `packages/ui/src/backend/utils/nav.ts` | Modify | Add `pageContext` filtering and `buildSectionPages` utility |
| `packages/ui/src/backend/section-page/` | New | `SectionPage` reusable layout component |
| `packages/shared/src/modules/page-metadata.ts` | Modify | Add `pageContext` and `placement` type definitions |

### Module Metadata Updates

| Module | Files | Change |
|--------|-------|--------|
| configs | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'system' }` |
| workflows | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'workflows' }` |
| entities | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'data-designer' }` |
| query_index | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'data-designer' }` |
| auth | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'auth' }` |
| auth (change-password) | `backend/auth/change-password/page.meta.ts` | Add `pageContext: 'profile'`, `placement: { section: 'account' }` |
| directory | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'directory' }` |
| business_rules | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'business-rules' }` |
| feature_toggles | `backend/**/page.meta.ts` | Add `pageContext: 'settings'`, `placement: { section: 'feature-toggles' }` |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SectionPage` | `packages/ui/src/backend/section-page/` | Reusable section page layout (vertical tabs + content) |
| `SectionNav` | `packages/ui/src/backend/section-page/` | Vertical-tab navigation for section pages |
| `SettingsPage` | `packages/core/src/modules/configs/backend/settings/` | Settings section page route |
| `ProfilePage` | `packages/core/src/modules/auth/backend/profile/` | Profile section page route |

---

## i18n Keys

```json
{
  "backend.nav.settings": "Settings",
  "backend.nav.profile": "Profile",
  "settings.page.title": "Settings",
  "settings.sections.system": "System",
  "settings.sections.auth": "Auth",
  "settings.sections.businessRules": "Business Rules",
  "settings.sections.dataDesigner": "Data Designer",
  "settings.sections.workflows": "Workflows",
  "settings.sections.moduleConfigs": "Module Configs",
  "settings.sections.directory": "Directory",
  "settings.sections.featureToggles": "Feature Toggles",
  "profile.page.title": "Profile",
  "profile.sections.account": "Account",
  "profile.sections.notifications": "Notifications"
}
```

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Visible sidebar items without scroll | 8-10 | All business groups visible | Viewport analysis |
| Clicks to reach Configuration | 1-2 | 2 (Settings -> item) | User journey tracking |
| Time to find settings | Variable | < 5s | User testing |
| User satisfaction (sidebar UX) | TBD | > 80% | Survey |

---

## Alternatives Considered

### Alternative 1: Three-Tier Sidebar (Collapsible + Profile Dropdown)
**Rejected (v2)**: The original proposal had a collapsible "Settings & Admin" section in the sidebar plus a profile dropdown with system settings. This was deemed too complex — having settings split across two locations (sidebar collapsible section and profile dropdown) hurts discoverability. A single "Settings" entry that opens a full page is simpler and more scalable.

### Alternative 2: Horizontal Tabs for Groups
**Rejected**: Doesn't scale with many groups, poor mobile experience.

### Alternative 3: Mega Menu Navigation
**Rejected**: Too complex, not consistent with current design language.

### Alternative 4: Separate Admin App
**Rejected**: Increases maintenance, poor integration with business modules.

### Alternative 5: User-Configurable Sidebar (Full)
**Deferred**: Good idea but complex to implement initially. The `pageContext` approach provides a foundation that could later support user customization.

---

## Open Questions

1. **Should some settings sections be visible based on user role?**
   - The left navigation should respect `requireFeatures` and hide sections the user can't access.

2. **How to handle deep links to settings pages?**
   - Direct URLs like `/backend/settings/cache` should render the SectionPage layout with the correct item selected. Breadcrumbs should show: Home > Settings > Cache.

3. **Should we support additional custom section pages beyond Settings and Profile?**
   - The pattern is generic (`pageContext` accepts any string), so modules could define their own section pages. This is a future consideration.

4. **Mobile navigation strategy?**
   - On narrow viewports, the section left-panel could be a collapsible drawer or a top-level list that navigates to full-page content.

---

## Changelog

### 2026-02-01 (v5)
- Top bar cleanup: removed "Organization" label and "Manage" link to save horizontal space; "Manage" (`/backend/directory/organizations`) relocates to Settings > Directory; added gear icon for Settings shortcut

### 2026-02-01 (v4)
- Clarified Profile entry point: the existing user avatar dropdown in the top bar stays, but its items (Change password, Preferences, etc.) now deep-link into the Profile section page with the correct sub-page pre-selected; Logout remains a direct action

### 2026-02-01 (v3)
- Added "Sidebar Customization Scope" section: existing customization (labels, reordering, hiding, role presets) applies only to the main sidebar, not to Settings/Profile internal navigation

### 2026-02-01 (v2)
- Clarified entry points: Settings accessible from both sidebar (bottom-pinned) and top bar (gear icon); Profile accessible only from top bar (user avatar)
- Removed Profile from the sidebar — it is a top-bar-only entry point
- Added top bar diagram to the architecture section
- Priority adjusted to Medium

### 2026-02-01
- Major revision: replaced three-tier architecture (collapsible sidebar section + profile dropdown) with a simpler **Settings page with internal vertical-tab navigation**
- Added Apple iPad Settings / Attio Settings as design benchmarks
- Introduced generic `SectionPage` component pattern reusable for Settings, Profile, and future section pages
- Added `placement` field to page metadata for controlling section grouping within a section page
- Added Profile section page (Change Password, Preferences, Notifications)
- Modules dynamically register settings pages via `pageContext` and `placement` in page metadata — no hardcoded registration needed
- Resolved open question about settings split across multiple locations — now consolidated into one Settings page
- Updated alternatives section: original three-tier approach moved to "Rejected" alternatives

### 2026-01-26
- Initial specification
- Documented current sidebar structure analysis
- Proposed three-tier navigation architecture
- Defined implementation phases
- Listed affected files and components
