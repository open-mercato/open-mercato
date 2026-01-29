# Sidebar Reorganization Specification

## Overview

This specification describes the reorganization of the backend admin panel sidebar to improve user experience by reducing clutter and minimizing the need for constant scrolling. The main proposal is to move the Configuration module (including system settings) and Workflows module into a dedicated user profile/settings area.

**Status:** Implemented (Phase 1 & 2)
**Priority:** High (UX improvement)
**Package Location:** `packages/ui/src/backend/AppShell.tsx`, various module `*.meta.ts` files

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

### Strategy: Create User Profile Settings Section

Move administrative and configuration-related items to a dedicated settings area accessible from the user profile menu (top-right corner or sidebar footer), keeping the main sidebar focused on business operations.

### New Navigation Architecture

```
┌─────────────────────────────────────────────────┐
│  Main Sidebar (Business Operations)             │
├─────────────────────────────────────────────────┤
│  📊 Dashboard                                   │
│  👥 Customers                                   │
│  📦 Catalog                                     │
│  💰 Sales                                       │
│  💱 Currencies                                  │
│  👔 Employees                                   │
│  📋 Resource planning                           │
├─────────────────────────────────────────────────┤
│                                                 │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                 │
│  ⚙️ Settings & Admin (collapsible or separate) │
│     └─ Auth                                     │
│     └─ Directory                                │
│     └─ Business Rules                           │
│     └─ Feature Toggles                          │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  User Profile Menu (Top-right dropdown)         │
├─────────────────────────────────────────────────┤
│  👤 My Profile                                  │
│  ─────────────────                              │
│  ⚙️ System Settings                             │
│     └─ Configuration                            │
│     └─ System Status                            │
│     └─ Cache                                    │
│  🔧 Data Designer                               │
│     └─ System Entities                          │
│     └─ User Entities                            │
│     └─ Query Indexes                            │
│  ⚡ Workflows                                   │
│     └─ Definitions                              │
│     └─ Instances                                │
│     └─ Tasks                                    │
│     └─ Events                                   │
│  ─────────────────                              │
│  🚪 Logout                                      │
└─────────────────────────────────────────────────┘
```

### Navigation Grouping Strategy

#### Tier 1: Main Sidebar (Business Operations)
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

#### Tier 2: Settings Sidebar Section (Admin Operations)
Administrative functions that are accessed less frequently. Can be a collapsible section at the bottom of the sidebar or a separate "Admin" area.

| Group | Contents | Target User |
|-------|----------|-------------|
| Auth | Users, Roles, API Keys | Admin |
| Directory | Organizations, Tenants | Super Admin |
| Business Rules | Rules, Sets, Logs | Power User |
| Feature Toggles | Global, Overrides | Admin |

#### Tier 3: User Profile/Settings Area (System Configuration)
System-level configuration and technical tools. Accessed from user profile dropdown or dedicated settings page.

| Section | Contents | Target User |
|---------|----------|-------------|
| System Settings | System Status, Cache, Module Configs | Admin |
| Data Designer | System/User Entities, Query Indexes | Developer |
| Workflows | Definitions, Instances, Tasks, Events | Power User |
| Module Configs | Sales, Catalog, Customers, Currencies, Dictionaries, Encryption | Admin |

---

## Implementation Approach

### Phase 1: Profile Settings Page

Create a dedicated settings hub page accessible from user profile menu.

#### New Route: `/backend/settings`

```typescript
// packages/core/src/modules/auth/backend/settings/page.tsx
export default function SettingsPage() {
  return (
    <Page>
      <PageBody>
        <SettingsNavigation />
        {/* Cards/links to different settings sections */}
      </PageBody>
    </Page>
  )
}
```

#### Settings Navigation Component

```typescript
// packages/ui/src/backend/settings/SettingsNavigation.tsx
type SettingsSection = {
  id: string
  titleKey: string
  icon: string
  href: string
  description: string
  requireFeatures?: string[]
}

const sections: SettingsSection[] = [
  {
    id: 'system',
    titleKey: 'settings.sections.system',
    icon: 'lucide:server',
    href: '/backend/config/system-status',
    description: 'System status, cache, and runtime configuration',
    requireFeatures: ['configs.system_status.view'],
  },
  {
    id: 'workflows',
    titleKey: 'settings.sections.workflows',
    icon: 'lucide:workflow',
    href: '/backend/workflows/definitions',
    description: 'Workflow definitions, instances, and automation',
    requireFeatures: ['workflows.view'],
  },
  {
    id: 'data-designer',
    titleKey: 'settings.sections.dataDesigner',
    icon: 'lucide:database',
    href: '/backend/entities/system',
    description: 'Entity definitions, custom fields, and indexes',
    requireFeatures: ['entities.view'],
  },
  // ... more sections
]
```

### Phase 2: Update Page Metadata

Move Configuration and Workflows items to a new navigation context.

#### Option A: New `pageContext` Metadata Field

```typescript
// packages/core/src/modules/configs/backend/config/system-status/page.meta.ts
export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.system_status.view'],
  pageTitle: 'System status',
  pageTitleKey: 'configs.config.nav.systemStatus',
  pageGroup: 'System', // Keep for breadcrumbs
  pageGroupKey: 'backend.nav.system',
  pageOrder: 120,
  icon: heartbeatIcon,
  // NEW: Controls where this page appears in navigation
  pageContext: 'settings', // 'main' | 'settings' | 'profile'
  navHidden: true, // Hide from main sidebar
}
```

#### Option B: Sidebar Preferences (User-configurable)

Allow users to customize which groups appear in the main sidebar vs. collapsed/settings area.

```typescript
// packages/shared/src/modules/navigation/sidebarPreferences.ts
export type SidebarPreference = {
  groupId: string
  placement: 'main' | 'collapsed' | 'hidden'
  order?: number
}

export const defaultPreferences: SidebarPreference[] = [
  { groupId: 'customers', placement: 'main', order: 1 },
  { groupId: 'catalog', placement: 'main', order: 2 },
  { groupId: 'sales', placement: 'main', order: 3 },
  // ...
  { groupId: 'configuration', placement: 'collapsed', order: 100 },
  { groupId: 'workflows', placement: 'collapsed', order: 101 },
]
```

### Phase 3: Update AppShell Component

Modify the `AppShell` component to support tiered navigation.

```typescript
// packages/ui/src/backend/AppShell.tsx
export type AppShellProps = {
  // ... existing props
  groups: NavGroup[]
  settingsGroups?: NavGroup[] // NEW: Groups for settings area
  profileMenuItems?: ProfileMenuItem[] // NEW: User profile dropdown items
}

// Render main navigation groups
function MainNav({ groups }: { groups: NavGroup[] }) {
  const mainGroups = groups.filter(g => g.context !== 'settings')
  const settingsGroups = groups.filter(g => g.context === 'settings')
  
  return (
    <>
      {/* Main business groups */}
      {mainGroups.map(group => <NavGroup key={group.id} {...group} />)}
      
      {/* Collapsible settings section */}
      {settingsGroups.length > 0 && (
        <CollapsibleSection title="Settings & Admin">
          {settingsGroups.map(group => <NavGroup key={group.id} {...group} />)}
        </CollapsibleSection>
      )}
    </>
  )
}
```

---

## UI/UX Guidelines

### Sidebar Behavior

1. **Main Groups**: Always visible, no collapse by default
2. **Settings Groups**: Collapsed by default, expandable
3. **User Preference**: Remember collapse state per user (localStorage + DB sync)
4. **Responsive**: On mobile, settings accessible via hamburger menu or profile

### Profile Dropdown Design

```
┌────────────────────────────────┐
│ 👤 John Doe                    │
│    john@example.com            │
├────────────────────────────────┤
│ 📝 My Profile                  │
│ ⚙️ Settings                    │→ Opens /backend/settings
│ 🔔 Notification Preferences    │
├────────────────────────────────┤
│ 🌙 Dark Mode          [Toggle] │
│ 🌐 Language           [Select] │
├────────────────────────────────┤
│ 🚪 Sign Out                    │
└────────────────────────────────┘
```

### Visual Hierarchy

- **Main Sidebar**: Full opacity, standard icons
- **Settings Section**: Slightly muted, smaller text, collapsible
- **Profile Menu**: Standard dropdown, icons aligned

---

## Migration Path

### Step 1: Non-breaking Changes
1. Add `pageContext` field to page metadata (optional, defaults to 'main')
2. Add settings page route
3. Add profile dropdown improvements

### Step 2: Opt-in Migration
1. Update individual module metadata to use `pageContext: 'settings'`
2. Start with least-used modules (configs, workflows)
3. Gather user feedback

### Step 3: Full Migration
1. Apply to all configuration-related modules
2. Update documentation
3. Announce changes to users

---

## Affected Files

### Core Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/ui/src/backend/AppShell.tsx` | Modify | Add support for tiered navigation |
| `packages/ui/src/backend/utils/nav.ts` | Modify | Add `pageContext` filtering |
| `packages/shared/src/modules/navigation/` | New | Navigation preferences types and helpers |

### Module Metadata Updates

| Module | Files | Change |
|--------|-------|--------|
| configs | `backend/**/page.meta.ts` | Add `pageContext: 'settings'` |
| workflows | `backend/**/page.meta.ts` | Add `pageContext: 'settings'` |
| entities | `backend/**/page.meta.ts` | Add `pageContext: 'settings'` |
| query_index | `backend/**/page.meta.ts` | Add `pageContext: 'settings'` |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SettingsPage` | `packages/core/src/modules/auth/backend/settings/` | Settings hub page |
| `SettingsNavigation` | `packages/ui/src/backend/settings/` | Settings section navigation |
| `CollapsibleNavSection` | `packages/ui/src/backend/` | Collapsible sidebar section |
| `ProfileDropdown` | `packages/ui/src/backend/` | Enhanced user profile menu |

---

## i18n Keys

```json
{
  "backend.nav.settings": "Settings",
  "backend.nav.settingsAdmin": "Settings & Admin",
  "settings.page.title": "Settings",
  "settings.page.description": "Manage system configuration, workflows, and data definitions",
  "settings.sections.system": "System Settings",
  "settings.sections.workflows": "Workflow Engine",
  "settings.sections.dataDesigner": "Data Designer",
  "settings.sections.moduleConfigs": "Module Configuration",
  "settings.profile.title": "My Profile",
  "settings.profile.preferences": "Preferences",
  "settings.profile.notifications": "Notification Preferences"
}
```

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Visible sidebar items without scroll | 8-10 | 12+ | Viewport analysis |
| Clicks to reach Configuration | 1-2 | 2-3 | User journey tracking |
| Time to find settings | Variable | < 5s | User testing |
| User satisfaction (sidebar UX) | TBD | > 80% | Survey |

---

## Alternatives Considered

### Alternative 1: Horizontal Tabs for Groups
**Rejected**: Doesn't scale with many groups, poor mobile experience

### Alternative 2: Mega Menu Navigation
**Rejected**: Too complex, not consistent with current design language

### Alternative 3: Separate Admin App
**Rejected**: Increases maintenance, poor integration with business modules

### Alternative 4: User-Configurable Sidebar (Full)
**Partially Adopted**: Good idea but complex to implement fully; we'll add basic collapse/expand first

---

## Open Questions

1. **Should Workflows remain in main sidebar for power users?**
   - Consider user role-based default placements

2. **How to handle deep links to settings pages?**
   - Ensure breadcrumbs and back navigation work correctly

3. **Should we add a "Favorites" or "Pinned" feature?**
   - Could help users quickly access frequently used settings

4. **Mobile navigation strategy?**
   - Hamburger menu with sections or bottom navigation?

---

## Changelog

### 2026-01-29
- Implemented Phase 1 & 2
- Added `pageContext` metadata field to `PageMetadata` type in `packages/shared/src/modules/registry.ts`
- Created `CollapsibleNavSection` component at `packages/ui/src/backend/CollapsibleNavSection.tsx`
- Created `ProfileDropdown` component at `packages/ui/src/backend/ProfileDropdown.tsx`
- Created `SettingsNavigation` component at `packages/ui/src/backend/settings/SettingsNavigation.tsx`
- Created Settings hub page at `packages/core/src/modules/auth/backend/settings/`
- Updated `AppShell` to filter navigation by `pageContext` and render collapsible settings section
- Updated 46 page.meta.ts files to add `pageContext: 'settings'` for admin modules (including API Keys)
- Added i18n translations for all 4 locales (en, de, es, pl)
- Integrated localStorage persistence for settings section collapse state
- Added `requireFeatures` to Settings hub page cards for feature-based visibility
- Added `userFeatures` prop to `SettingsNavigation` for client-side feature filtering

### 2026-01-26
- Initial specification
- Documented current sidebar structure analysis
- Proposed three-tier navigation architecture
- Defined implementation phases
- Listed affected files and components

