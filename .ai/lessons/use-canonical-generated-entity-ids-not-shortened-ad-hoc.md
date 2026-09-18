---
title: "Use canonical generated entity ids, not shortened ad-hoc aliases"
modules: ["checkout","entities","query_index"]
areas: ["module-data","umes","architecture"]
topics: ["auto-discovery","custom-fields","data-integrity"]
---

# Use canonical generated entity ids, not shortened ad-hoc aliases

**Context**: Checkout used shortened ids like `checkout:link` and `checkout:transaction`, while the generated canonical ids for its ORM entities are `checkout:checkout_link` and `checkout:checkout_transaction`.

**Problem**: Query/index/search/encryption helpers rely on canonical entity ids to infer table names and registry metadata. The shortened aliases pushed reindexing toward `links` instead of `checkout_links` and silently diverged from the generated contract.

**Rule**: For ORM-backed entities, use the generated canonical entity ids consistently across CRUD indexers, search config, translations, encryption defaults, and custom-entity declarations. Do not invent shorter aliases unless the platform explicitly supports them everywhere.

**Applies to**: Any module that participates in generated entity ids, query index/search, translations, encryption maps, or custom field registration.
