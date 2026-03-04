import type { ModuleInfo } from "@open-mercato/shared/modules/registry";

export const metadata: ModuleInfo = {
  name: "airtable_import",
  title: "Airtable Import",
  version: "0.1.0",
  description: "Migrate data from Airtable bases to Open Mercato.",
  author: "Open Mercato Team",
  license: "Proprietary",
  ejectable: false,
};

export { features } from "./acl";
