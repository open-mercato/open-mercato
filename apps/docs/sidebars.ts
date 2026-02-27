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
      items: [
        "installation/prerequisites",
        "installation/setup",
        {
          type: "link",
          label: "Standalone App (create-mercato-app)",
          href: "/customization/standalone-app",
        },
      ],
    },
    {
      type: "category",
      label: "User Guide",
      items: [
        "user-guide/overview",
        "user-guide/login",
        "user-guide/users-and-roles",
        "user-guide/api-keys",
        "user-guide/feature-toggles",
        "user-guide/custom-fieldsets",
        "user-guide/encryption",
        "user-guide/user-custom-fields",
        "user-guide/dictionaries",
        "user-guide/currencies",
        "user-guide/user-entities",
        "user-guide/system-status",
        "user-guide/products-and-sales-channels",
        "user-guide/cache-management",
        "user-guide/taxes",
        "user-guide/search",
        "user-guide/perspectives-and-sidebar",
        "user-guide/organizations",
        {
          type: "category",
          label: "Resources & Staff",
          items: [
            "user-guide/resources-and-resource-types",
            "user-guide/teams-and-team-members",
            "user-guide/leave-requests-and-availability",
          ],
        },
        {
          type: "category",
          label: "Sales",
          items: [
            "user-guide/sales/orders-and-quotes",
            "user-guide/sales/create-sales-document",
            "user-guide/sales/edit-order-quote",
            "user-guide/sales/payments",
            "user-guide/sales/shipments",
            "user-guide/sales/adjustments",
            "user-guide/sales/order-items",
            "user-guide/sales/sales-settings",
          ],
        },
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
        {
          type: "category",
          label: "Business Rules",
          items: [
            "user-guide/business-rules/index",
            "user-guide/business-rules/creating-rules",
            "user-guide/business-rules/rule-types",
            "user-guide/business-rules/conditions",
            "user-guide/business-rules/actions",
            "user-guide/business-rules/rule-sets",
            "user-guide/business-rules/execution-logs",
          ],
        },
        {
          type: "category",
          label: "Workflows",
          items: [
            "user-guide/workflows/index",
            "user-guide/workflows/creating-workflows",
            "user-guide/workflows/step-types",
            "user-guide/workflows/activities",
            "user-guide/workflows/transitions",
            "user-guide/workflows/signals",
            "user-guide/workflows/user-tasks",
            "user-guide/workflows/monitoring",
          ],
        },
        "user-guide/inbox-ops",
        "user-guide/audit-logs",
        "user-guide/scheduler",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      items: ["architecture/system-overview", "architecture/data-encryption"],
    },
    {
      type: "category",
      label: "Enterprise Edition",
      items: [
        "enterprise/overview",
        "enterprise/record-locks",
      ],
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
            "api/attachments",
            "api/vector",
            "api/feature-toggles",
            "api/scheduler",
            {
              type: "category",
              label: "Business Rules",
              items: [
                "api/business-rules",
                "api/business-rules/rules",
                "api/business-rules/execute",
                "api/business-rules/logs",
                "api/business-rules/sets",
              ],
            },
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
          label: "Development Runtime",
          items: ["cli/dev-ephemeral"],
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
          label: "Feature Toggles Module",
          items: [
            "cli/feature-toggles-toggle-create",
            "cli/feature-toggles-toggle-update",
            "cli/feature-toggles-toggle-delete",
            "cli/feature-toggles-override-set",
            "cli/feature-toggles-seed-defaults",
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
        {
          type: "category",
          label: "Integration Testing",
          items: ["cli/test-integration", "cli/test-ephemeral"],
        },
        "cli/scheduler",
        "cli/eject",
      ],
    },
    {
      type: "category",
      label: "Customization Tutorials",
      items: [
        "customization/standalone-app",
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
            "framework/modules/notifications",
            "framework/modules/messages",
            "framework/modules/currencies",
            "framework/modules/sales-providers",
            "framework/modules/sales-calculations",
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
            "framework/database/hybrid-search",
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
            "framework/widget-injection",
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
            "framework/api/api-development-guide",
            "framework/api/crud-factory",
            "framework/api/building-api-modules",
            "framework/api/extending-api",
          ],
        },
        {
          type: "category",
          label: "Events & Queue",
          items: [
            "framework/events/overview",
            "framework/events/queue-workers",
          ],
        },
        "framework/pricing-tax-overrides",
        "framework/rbac/overview",
        "framework/feature-toggles/overview",
        {
          type: "category",
          label: "Security",
          items: [
            "framework/security/rate-limiting",
          ],
        },
        {
          type: "category",
          label: "Runtime",
          items: [
            "framework/runtime/data-engine",
            "framework/runtime/request-lifecycle",
          ],
        },
        {
          type: "category",
          label: "Business Rules",
          items: [
            "framework/business-rules/architecture",
            "framework/business-rules/services",
            "framework/business-rules/extending",
          ],
        },
        {
          type: "category",
          label: "Workflows",
          items: [
            "framework/workflows/index",
            "framework/workflows/architecture",
            "framework/workflows/services",
            "framework/workflows/extending",
            "framework/workflows/testing",
          ],
        },
        {
          type: "category",
          label: "Operations",
          items: [
            "framework/operations/system-status",
          ],
        },
        "framework/progress/overview",
        {
          type: "category",
          label: "Scheduler",
          items: [
            "framework/scheduler/overview",
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
        {
          type: "category",
          label: "Business Rules",
          items: ["tutorials/business-rules/material-availability"],
        },
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
