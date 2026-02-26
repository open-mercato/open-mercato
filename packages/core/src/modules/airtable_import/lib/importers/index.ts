import type { ModuleImporter } from "./types";
import { importPerson, importCompany, importDeal } from "./customers";
import { importProduct } from "./catalog";
import { importOrder } from "./sales";
import { importStaffMember } from "./staff";
import { importCustomEntityRecord } from "./custom-entity";

export function resolveImporter(targetModule: string | null): ModuleImporter {
  switch (targetModule) {
    case "customers.people":
      return importPerson;
    case "customers.companies":
      return importCompany;
    case "customers.deals":
      return importDeal;
    case "catalog.products":
      return importProduct;
    case "sales.orders":
      return importOrder;
    case "staff.members":
      return importStaffMember;
    default:
      return importCustomEntityRecord as ModuleImporter;
  }
}
