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
      label: 'example.menu.todosShortcut',
      href: '/backend/example/todos',
      groupId: 'example.nav.group',
      groupLabelKey: 'example.nav.group',
      placement: { position: InjectionPosition.Last },
    },
    {
      id: 'example-quick-add-todo',
      label: 'example.menu.quickAddTodo',
      href: '/backend/example/todos/create',
      placement: { position: InjectionPosition.Last },
    },
  ],
}

export default widget
