import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'example.injection.example-profile-menu',
  },
  menuItems: [
    {
      id: 'example-quick-add-todo',
      labelKey: 'example.menu.quickAddTodo',
      label: 'Quick Add Todo',
      icon: 'PlusSquare',
      href: '/backend/todos/create',
      features: ['example.todos.manage'],
      placement: { position: InjectionPosition.Before, relativeTo: 'sign-out' },
    },
  ],
}

export default widget
