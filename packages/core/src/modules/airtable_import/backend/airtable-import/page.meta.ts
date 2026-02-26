import React from "react";

const importIcon = React.createElement(
  "svg",
  {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
  }),
  React.createElement("polyline", { points: "7 10 12 15 17 10" }),
  React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" }),
);

export const metadata = {
  requireAuth: true,
  requireFeatures: ["airtable_import.view"],
  pageTitle: "Import z Airtable",
  pageTitleKey: "airtable_import.nav.title",
  pageGroup: "Ustawienia",
  pageGroupKey: "nav.settings",
  pagePriority: 90,
  pageOrder: 500,
  icon: importIcon,
  breadcrumb: [
    { label: "Import z Airtable", labelKey: "airtable_import.nav.title" },
  ],
};
