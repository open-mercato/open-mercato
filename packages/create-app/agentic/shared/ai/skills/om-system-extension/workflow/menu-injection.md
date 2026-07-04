# Widget Injection — Menu Items

**Purpose**: Add items to sidebar, topbar, or profile dropdown.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

## Template

```typescript
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const widget: InjectionMenuItemWidget = {
  metadata: { id: '<your-module>.injection.menus' },
  menuItems: [
    {
      id: '<your-module>-<page>-link',
      labelKey: '<your-module>.menu.<pageName>',  // i18n key
      label: 'Fallback Label',  // Fallback if i18n missing
      icon: 'LayoutDashboard',  // Lucide icon name
      href: '/backend/<your-module>',
      features: ['<your-module>.view'],  // ACL gating
      groupId: '<your-module>.nav.group',
      groupLabelKey: '<your-module>.nav.group',
      placement: { position: InjectionPosition.Last },
    },
  ],
}

export default widget
```

## Available Spot IDs

| Spot ID | Location |
|---------|----------|
| `menu:sidebar:main` | Main sidebar navigation |
| `menu:sidebar:settings` | Settings sidebar |
| `menu:sidebar:profile` | Profile sidebar |
| `menu:topbar:profile-dropdown` | User profile dropdown |
| `menu:topbar:actions` | Top bar action area |

## Rules

- Use `labelKey` (i18n) instead of `label` whenever possible
- Always set `features` for permission-gated items
- Use `groupId` + `groupLabelKey` to group related menu items
- Menu `id` must be stable for integration tests
