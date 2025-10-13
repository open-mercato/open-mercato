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
        'architecture/data-engine',
        'architecture/request-lifecycle',
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
        'customization/modules/quickstart',
        'customization/modules/authoring-first-module',
        'customization/api/extending-api',
        'customization/data-entities/data-extensibility',
        'customization/forms/crud-form',
        'customization/forms/field-registry',
        'customization/forms/custom-field-validation',
        'customization/grids/data-grids',
        'customization/dashboard-widgets/overview',
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
            'framework/database/query-layer',
            'framework/database/query-index',
          ],
        },
        'framework/custom-entities/overview',
        {
          type: 'category',
          label: 'API Routes',
          items: [
            'framework/api/overview',
            'framework/api/crud-factory',
          ],
        },
        'framework/events/overview',
        'framework/rbac/overview',
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
