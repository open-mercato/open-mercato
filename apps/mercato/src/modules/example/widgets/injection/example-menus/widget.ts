import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'example.injection.example-menus',
    features: ['example.view'],
  },
  menuItems: [
    {
      id: 'example-todos-shortcut',
      labelKey: 'example.menu.todosShortcut',
      label: 'Example Todos',
      href: '/backend/example/todos',
      groupId: 'example.nav.group',
      groupLabelKey: 'example.nav.group',
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
    {
      id: 'example-quick-add-todo',
      labelKey: 'example.menu.quickAddTodo',
      label: 'Quick Add Todo',
      href: '/backend/example/todos/create',
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
  ],
}

export default widget
