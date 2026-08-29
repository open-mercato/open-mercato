import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
} from "@open-mercato/shared/modules/widgets/extension-points";

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: "wms",
  hosts: {
    sitesTable: dataTableExtensionHost({
      tableId: "wms.sites.list",
      source: "components/backend/WmsSitesPage.tsx",
    }),
    siteWarehouseRolesTable: dataTableExtensionHost({
      tableId: "wms.site_warehouse_roles.list",
      source: "components/backend/WmsSitesPage.tsx",
    }),
    siteForm: crudFormExtensionHost({
      entityId: "wms:site",
      source: "components/backend/WmsSitesPage.tsx",
    }),
    siteWarehouseRoleForm: crudFormExtensionHost({
      entityId: "wms:site_warehouse_role",
      source: "components/backend/SiteWarehouseRoleDialog.tsx",
    }),
    warehousesTable: dataTableExtensionHost({
      tableId: "wms.config.warehouses",
      source: "components/backend/WmsConfigurationPage.tsx",
    }),
    zonesTable: dataTableExtensionHost({
      tableId: "wms.config.zones",
      source: "components/backend/WmsConfigurationPage.tsx",
    }),
    locationsTable: dataTableExtensionHost({
      tableId: "wms.config.locations",
      source: "components/backend/WmsConfigurationPage.tsx",
    }),
    inventoryProfilesTable: dataTableExtensionHost({
      tableId: "wms.config.inventoryProfiles",
      source: "components/backend/WmsConfigurationPage.tsx",
    }),
    balancesTable: dataTableExtensionHost({
      tableId: "wms.inventory.balances",
      source: "components/backend/WmsInventoryConsolePage.tsx",
    }),
    reservationsTable: dataTableExtensionHost({
      tableId: "wms.inventory.reservations",
      source: "components/backend/WmsInventoryConsolePage.tsx",
    }),
    movementsTable: dataTableExtensionHost({
      tableId: "wms.inventory.movements",
      source: "components/backend/WmsInventoryConsolePage.tsx",
    }),
    locationItemsTable: dataTableExtensionHost({
      tableId: "wms.location.items",
      source: "components/backend/WmsLocationDetailPage.tsx",
    }),
    locationActivityTable: dataTableExtensionHost({
      tableId: "wms.location.activity",
      source: "components/backend/WmsLocationDetailPage.tsx",
    }),
    lotDistributionTable: dataTableExtensionHost({
      tableId: "wms.lot.distribution",
      source: "components/backend/WmsLotDetailPage.tsx",
    }),
    lotActivityTable: dataTableExtensionHost({
      tableId: "wms.lot.activity",
      source: "components/backend/WmsLotDetailPage.tsx",
    }),
    lotsTable: dataTableExtensionHost({
      tableId: "wms.lots.list",
      source: "components/backend/WmsLotsListPage.tsx",
    }),
    skuDistributionTable: dataTableExtensionHost({
      tableId: "wms.sku.distribution",
      source: "components/backend/WmsSkuDetailPage.tsx",
    }),
    skuActivityTable: dataTableExtensionHost({
      tableId: "wms.sku.activity",
      source: "components/backend/WmsSkuDetailPage.tsx",
    }),
  },
});

export default extensionPoints;
