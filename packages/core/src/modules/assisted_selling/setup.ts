import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

// §6.9 (D-R5-7, D-R5-34, D-R5-AS1): employee may view, join and post in conversations, and
// reads proposal carts because GET /threads/:id requires cart.proposals.view (#8405).
// Authoring, attribution and settings stay with admin or are granted by hand.
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['assisted_selling.*'],
    employee: [
      'assisted_selling.threads.view',
      'assisted_selling.threads.participate',
      'assisted_selling.messages.post',
      'cart.proposals.view',
    ],
  },
}

export default setup
