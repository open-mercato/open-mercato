Use the om-spec-writing skill to write one feature spec: "Market display profile with a US seed".

The attached CORE-us-display-profile.BRIEF.attach.md is the complete input besides the repository. Read it fully before writing the skeleton. Its section 1 contains owner decisions D1 to D11; apply them as given and record them under Design Decisions with their rationale instead of raising them as Open Questions. Section 8 lists the questions you are expected to answer yourself during research and design.

This is a core platform contribution, OSS scope, one spec, not split (D1). It is display only: no tax calculation, no address validation, no carriers, no currency conversion, no external service. It is universal in shape and seeded for the United States; existing tenants keep today's behavior through a seeded `eu` profile until an admin switches.

Read first: the brief, then root AGENTS.md and the Task Router rows for module development, settings, encryption, design system, i18n and API routes, then the pending specs named in brief section 7 so your Migration and Compatibility section records how this spec completes or supersedes each of them.

Ground every claim in the repository. The brief cites file paths and line numbers verified at commit ab23d45f; if the branch has moved, re-verify a cited line before relying on it and say so in the spec.

Content the spec must contain, in the template's sections: the `market_display_profile` entity and the `subdivision` list with the field tables from brief section 3.1 and 3.2 and the US seed values; the shared formatting layer (3.3) with function signatures; the price presentation switch and the additive tax display fields plus the `TaxCalculator` DI interface with its stub (3.4); the `us` address layout behavior in both address editor twins or the collapsed one (3.5); unit validation, defaults and the feet and inches and pounds helpers with the shipment wizard conversion (3.6); paper size in the documents renderer (3.7); exports and emails (3.8); the `en-US` overlay dictionary; the admin settings page under the two level settings sidebar; an onboarding market selection step; commands with undo for the profile.

Implementation plan: Phase 1 entity, seed, resolver and helpers; Phase 2 wave 1 migration exactly as the manifest in brief section 5.1 with a file manifest table; Phase 3 wave 2 as the long tail manifest plus the ESLint rule in brief section 5.2, explicitly allowed to land after the hackathon. Integration coverage must include the acceptance scenario in brief section 6 and a Polish tenant unchanged on the same instance.

Market reference to study: Shopware sales channel and snippet sets, Magento store view locale scopes, Shopify markets and address formats, Odoo company localization. State what you adopt and reject.

Output: .ai/specs/2026-09-18-market-display-profile.md. Follow the spec template, run the checklist and the compliance review, and end with the Final Compliance Report and Changelog.

Plain hyphens only in everything you write. No em dashes, no en dashes.
