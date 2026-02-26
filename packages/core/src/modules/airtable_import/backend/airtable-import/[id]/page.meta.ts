export const metadata = {
  requireAuth: true,
  requireFeatures: ["airtable_import.view"],
  breadcrumb: [
    {
      label: "Import z Airtable",
      labelKey: "airtable_import.nav.title",
      href: "/backend/airtable-import",
    },
    { label: "Sesja importu", labelKey: "airtable_import.nav.session" },
  ],
};
