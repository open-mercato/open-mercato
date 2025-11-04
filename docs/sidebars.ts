import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "category",
      label: "Introduction",
      collapsible: false,
      items: ["introduction/overview", "introduction/use-cases"],
    },
    {
      type: "category",
      label: "Installation",
      items: ["installation/prerequisites", "installation/setup"],
    },
    {
      type: "category",
      label: "User Guide",
      items: [
        "user-guide/overview",
        "user-guide/login",
        "user-guide/users-and-roles",
        "user-guide/api-keys",
        "user-guide/user-custom-fields",
        "user-guide/dictionaries",
        "user-guide/user-entities",
        "user-guide/system-status",
        "user-guide/cache-management",
        "user-guide/vector-search",
        "user-guide/perspectives-and-sidebar",
        "user-guide/organizations",
        {
          type: "category",
          label: "Customers",
          items: [
            "user-guide/customers",
            "user-guide/customers/people",
            "user-guide/customers/companies",
            "user-guide/customers/deals",
          ],
        },
        "user-guide/audit-logs",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: ["architecture/system-overview"],
    },
    {
      type: "category",
      label: "REST API",
      items: [
        "api/overview",
        {
          type: "category",
          label: "Module Guides",
          items: [
            "api/auth",
            "api/directory",
            "api/dashboards",
            "api/customers",
            "api/entities",
            "api/vector",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "CLI",
      items: [
        "cli/overview",
        "cli/api-keys",
        {
          type: "category",
          label: "Bootstrap & Database",
          items: [
            "cli/init",
            "cli/db-generate",
            "cli/db-migrate",
            "cli/db-greenfield",
          ],
        },
        {
          type: "category",
          label: "Auth Module",
          items: [
            "cli/auth-seed-roles",
            "cli/auth-setup",
            "cli/auth-add-user",
            "cli/auth-set-password",
            "cli/auth-list-orgs",
            "cli/auth-list-users",
            "cli/auth-list-tenants",
          ],
        },
        {
          type: "category",
          label: "Example Module",
          items: ["cli/example-seed-todos", "cli/example-hello"],
        },
        {
          type: "category",
          label: "Entities",
          items: ["cli/entities-install"],
        },
      ],
    },
    {
      type: "category",
      label: "Customization Tutorials",
      items: [
        "customization/build-first-app",
        "customization/create-first-module",
        "customization/create-inventory-data",
        "customization/create-inventory-api",
        "customization/list-inventory",
        "customization/inventory-crud-forms",
        "customization/custom-fields-overview",
      ],
    },
    {
      type: "category",
      label: "Framework Reference",
      items: [
        "framework/ioc/container",
        {
          type: "category",
          label: "Modules",
          items: [
            "framework/modules/overview",
            "framework/modules/routes-and-pages",
          ],
        },
        "framework/commands/overview",
        {
          type: "category",
          label: "Database & Entities",
          items: [
            "framework/database/entities",
            "framework/database/data-extensibility",
          "framework/database/query-engine",
          "framework/database/hybrid-query-engine",
          "framework/database/query-index",
          "framework/database/vector-search",
          ],
        },
        "framework/custom-entities/overview",
        {
          type: "category",
          label: "Admin UI",
          items: [
            "framework/admin-ui/data-grids",
            "framework/admin-ui/crud-form",
            "framework/admin-ui/field-registry",
            "framework/admin-ui/custom-field-validation",
            "framework/admin-ui/perspectives"
          ],
        },
        {
          type: "category",
          label: "Dashboard",
          items: ["framework/dashboard/widgets-overview"],
        },
        {
          type: "category",
          label: "API Routes",
          items: [
            "framework/api/overview",
            "framework/api/crud-factory",
            "framework/api/extending-api",
          ],
        },
        "framework/events/overview",
        "framework/rbac/overview",
        {
          type: "category",
          label: "Runtime",
          items: [
            "framework/runtime/data-engine",
            "framework/runtime/request-lifecycle",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Hands-on Tutorials",
      items: [
        "tutorials/first-app",
        "tutorials/building-todo-module",
        "tutorials/authoring-first-module",
        "tutorials/api-data-fetching",
        "tutorials/testing",
      ],
    },
    {
      type: "category",
      label: "Appendix",
      items: [
        "architecture/glossary",
        "architecture/future-roadmap",
        "appendix/troubleshooting",
      ],
    },
  ],
};

export default sidebars;


import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "category",
      label: "Introduction",
      collapsible: false,
      items: ["introduction/overview", "introduction/use-cases"],
    },
    {
      type: "category",
      label: "Installation",
      items: ["installation/prerequisites", "installation/setup"],
    },
    {
      type: "category",
      label: "User Guide",
      items: [
        "user-guide/overview",
        "user-guide/login",
        "user-guide/users-and-roles",
        "user-guide/api-keys",
        "user-guide/user-custom-fields",
        "user-guide/dictionaries",
        "user-guide/user-entities",
        "user-guide/system-status",
        "user-guide/cache-management",
        "user-guide/vector-search",
        "user-guide/perspectives-and-sidebar",
        "user-guide/organizations",
        {
          type: "category",
          label: "Customers",
          items: [
            "user-guide/customers",
            "user-guide/customers/people",
            "user-guide/customers/companies",
            "user-guide/customers/deals",
          ],
        },
        "user-guide/audit-logs",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: ["architecture/system-overview"],
    },
    {
      type: "category",
      label: "REST API",
      items: [
        "api/overview",
        {
          type: "category",
          label: "Module Guides",
          items: [
            "api/auth",
            "api/directory",
            "api/dashboards",
            "api/customers",
            "api/entities",
            "api/vector",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "TypeScript API Client",
      items: [
        "api-client/introduction",
        "api-client/usage",
        "api-client/api-reference",
      ],
    },
    {
      type: "category",
      label: "CLI",
      items: [
        "cli/overview",
        "cli/api-keys",
        {
          type: "category",
          label: "Bootstrap & Database",
          items: [
            "cli/init",
            "cli/db-generate",
            "cli/db-migrate",
            "cli/db-greenfield",
          ],
        },
        {
          type: "category",
          label: "Auth Module",
          items: [
            "cli/auth-seed-roles",
            "cli/auth-setup",
            "cli/auth-add-user",
            "cli/auth-set-password",
            "cli/auth-list-orgs",
            "cli/auth-list-users",
            "cli/auth-list-tenants",
          ],
        },
        {
          type: "category",
          label: "Example Module",
          items: ["cli/example-seed-todos", "cli/example-hello"],
        },
        {
          type: "category",
          label: "Entities",
          items: ["cli/entities-install"],
        },
      ],
    },
    {
      type: "category",
      label: "Customization Tutorials",
      items: [
        "customization/build-first-app",
        "customization/create-first-module",
        "customization/create-inventory-data",
        "customization/create-inventory-api",
        "customization/list-inventory",
        "customization/inventory-crud-forms",
        "customization/custom-fields-overview",
      ],
    },
    {
      type: "category",
      label: "Framework Reference",
      items: [
        "framework/ioc/container",
        {
          type: "category",
          label: "Modules",
          items: [
            "framework/modules/overview",
            "framework/modules/routes-and-pages",
          ],
        },
        "framework/commands/overview",
        {
          type: "category",
          label: "Database & Entities",
          items: [
            "framework/database/entities",
            "framework/database/data-extensibility",
          "framework/database/query-engine",
          "framework/database/hybrid-query-engine",
          "framework/database/query-index",
          "framework/database/vector-search",
          ],
        },
        "framework/custom-entities/overview",
        {
          type: "category",
          label: "Admin UI",
          items: [
            "framework/admin-ui/data-grids",
            "framework/admin-ui/crud-form",
            "framework/admin-ui/field-registry",
            "framework/admin-ui/custom-field-validation",
            "framework/admin-ui/perspectives"
          ],
        },
        {
          type: "category",
          label: "Dashboard",
          items: ["framework/dashboard/widgets-overview"],
        },
        {
          type: "category",
          label: "API Routes",
          items: [
            "framework/api/overview",
            "framework/api/crud-factory",
            "framework/api/extending-api",
          ],
        },
        "framework/events/overview",
        "framework/rbac/overview",
        {
          type: "category",
          label: "Runtime",
          items: [
            "framework/runtime/data-engine",
            "framework/runtime/request-lifecycle",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Hands-on Tutorials",
      items: [
        "tutorials/first-app",
        "tutorials/building-todo-module",
        "tutorials/authoring-first-module",
        "tutorials/api-data-fetching",
        "tutorials/testing",
      ],
    },
    {
      type: "category",
      label: "Appendix",
      items: [
        "architecture/glossary",
        "architecture/future-roadmap",
        "appendix/troubleshooting",
      ],
    },
  ],
};

export default sidebars;