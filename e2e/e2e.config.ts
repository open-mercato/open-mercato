import type { E2EConfig } from 'e2e';
import { createAgent } from 'e2e/agent';
import { playwright } from '@e2edev/playwright';
import { gateway } from 'ai';

// The Open Mercato admin runs at APP_URL (default: the local dev server).
// Start it first: `yarn dev` in the repository root, or point APP_URL at an
// ephemeral environment from `yarn test:integration:ephemeral:start`.
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// Demo accounts seeded by `yarn mercato init`. Override per run with
// E2E_USER_<NAME>_USERNAME / E2E_USER_<NAME>_PASSWORD.
const DEMO_PASSWORD = process.env.OM_DEMO_PASSWORD ?? 'secret';

const model = gateway(process.env.E2E_MODEL ?? 'openai/gpt-5.6-luna');

export default {
  projectId: 'open-mercato',
  targets: [{ name: 'web', engine: playwright({ url: APP_URL, viewport: { width: 1440, height: 900 } }) }],

  // Dev-mode Next.js compiles a route on first visit, so budgets are generous.
  timeout: 240_000,
  actionTimeout: 45_000,
  assertionTimeout: 20_000,
  workers: 2,

  agents: {
    default: {
      executor: createAgent({
        model,
        system: [
        'You are a careful QA engineer testing the Open Mercato admin, a B2B commerce and CRM backend.',
        'Complete exactly the goal you are given, verify the outcome on screen, and stop.',
        'Never invent data: use the values handed to you in params, and leave optional fields empty unless the goal names them.',
        'If a dialog you did not ask for appears (cookie notice, demo notice, "Talk to Open Mercato team" feedback), close it and continue.',
        'Prefer the visible labels of buttons and fields. Lists load asynchronously; wait for "Loading" indicators to disappear before judging a list.',
        ].join(' '),
      }),
      model,
      context: [
        'Open Mercato vocabulary:',
        '- The admin lives under /backend with a left sidebar. List pages have a "Search" box and a "Create" button or link in the page header; the empty state may repeat the same "Create" link.',
        '- Create and edit forms are grouped into sections. The primary submit button is labelled with the action, e.g. "Create Company", "Create Person", "Create product", "Create", or "Save".',
        '- Customers: companies at /backend/customers/companies, people at /backend/customers/people. A saved record opens its detail page (URL ends in /companies-v2/<id> or /people-v2/<id>).',
        '- Catalog: products at /backend/catalog/products. The product form has a "General data" tab (title placeholder "e.g., Summer sneaker", description "Describe the product...") and a "Variants" tab (SKU placeholder "e.g., SKU-001"). Descriptions must be at least one full sentence; short ones fail SEO validation.',
        '- Sales: quotes and orders are "sales documents" created at /backend/sales/documents/create?kind=quote (or kind=order). The form asks for a customer ("Search customers") and a sales channel ("Select a channel"): both are comboboxes, so click the field, type the name, then pick the matching option from the list; an address combobox may appear after the customer is chosen. Then "Create". A document page has tabs such as "Items", "Shipments", "Payments", and an "Actions" menu (e.g. "Convert to order"). "Add item" opens a dialog with a "Custom line" option: "Optional line name", unit price (placeholder "0.00"), quantity (placeholder "1"), then "Add item".',
        '- Users at /backend/users (roles are typed into a tag input: type the role and press Enter). Roles at /backend/roles. API keys at /backend/api-keys; a new key is shown once in a "Keep this key safe" dialog with a "Prefix: omk_..." line.',
        '- The account menu is the button in the top-right corner showing the signed-in email; it contains "Logout".',
        '- Demo tenant "Acme Corp" has one organization. Demo companies include "Brightside Solar"; a demo sales channel is "Mercato Fashion Online".',
      ].join('\n'),
    },
  },

  credentials: {
    admin: { username: 'admin@acme.com', password: DEMO_PASSWORD },
    employee: { username: 'employee@acme.com', password: DEMO_PASSWORD },
    superadmin: { username: process.env.OM_INIT_SUPERADMIN_EMAIL ?? 'superadmin@acme.com', password: process.env.OM_INIT_SUPERADMIN_PASSWORD ?? DEMO_PASSWORD },
  },

  secrets: {
    // Password given to users the suite creates; the model only ever sees the name.
    'new-user-password': process.env.E2E_NEW_USER_PASSWORD ?? 'Valid1!Pass',
  },
} satisfies E2EConfig;
