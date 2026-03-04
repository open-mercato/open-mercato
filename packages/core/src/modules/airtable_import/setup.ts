import type { ModuleSetupConfig } from "@open-mercato/shared/modules/setup";

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ["airtable_import.view", "airtable_import.manage"],
    admin: ["airtable_import.view", "airtable_import.manage"],
  },
};

export default setup;
