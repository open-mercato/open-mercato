import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Introduction',
      collapsible: false,
      items: [
        'introduction/overview',
        'introduction/use-cases',
        'introduction/platform-architecture',
      ],
    },
    {
      type: 'category',
      label: 'Installation',
      items: [
        'installation/prerequisites',
        'installation/setup',
        'installation/deploy-vercel',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      items: [
        'user-guide/overview',
        'user-guide/login',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/system-overview',
      ],
    },
    {
      type: 'category',
      label: 'CLI',
      items: [
        'cli/overview',
      ],
    },
    {
      type: 'category',
      label: 'Customization Tutorials',
      items: [
        'customization/build-first-app',
        'customization/create-first-module',
        'customization/create-inventory-data',
        'customization/create-inventory-api',
        'customization/list-inventory',
        'customization/inventory-crud-forms',
        'customization/custom-fields-overview',
      ],
    },
    {
      type: 'category',
      label: 'Hands-on Tutorials',
      items: [
        'tutorials/first-app',
        'tutorials/building-todo-module',
        'tutorials/authoring-first-module',
        'tutorials/api-data-fetching',
        'tutorials/testing',
      ],
    },
    {
      type: 'category',
      label: 'Framework Reference',
      items: [
        'framework/ioc/container',
        {
          type: 'category',
          label: 'Modules',
          items: [
            'framework/modules/overview',
            'framework/modules/routes-and-pages',
          ],
        },
        {
          type: 'category',
          label: 'Database & Entities',
          items: [
            'framework/database/entities',
            'framework/database/data-extensibility',
            'framework/database/query-engine',
            'framework/database/hybrid-query-engine',
            'framework/database/query-index',
          ],
        },
        'framework/custom-entities/overview',
        {
          type: 'category',
          label: 'Admin UI',
          items: [
            'framework/admin-ui/data-grids',
            'framework/admin-ui/crud-form',
            'framework/admin-ui/field-registry',
            'framework/admin-ui/custom-field-validation',
          ],
        },
        {
          type: 'category',
          label: 'Dashboard',
          items: ['framework/dashboard/widgets-overview'],
        },
        {
          type: 'category',
          label: 'API Routes',
          items: [
            'framework/api/overview',
            'framework/api/crud-factory',
            'framework/api/extending-api',
          ],
        },
        'framework/events/overview',
        'framework/rbac/overview',
        {
          type: 'category',
          label: 'Runtime',
          items: [
            'framework/runtime/data-engine',
            'framework/runtime/request-lifecycle',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Appendix',
      items: [
        'architecture/glossary',
        'architecture/future-roadmap',
        'appendix/troubleshooting',
      ],
    },
  ],
};

export default sidebars;
