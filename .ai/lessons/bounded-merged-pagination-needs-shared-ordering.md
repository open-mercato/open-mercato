---
title: "Bounded merged pagination needs a shared ordering"
modules: ["workflows"]
areas: ["architecture", "module-data", "testing"]
topics: ["pagination", "database-queries", "sorting", "pagination-boundaries"]
---

# Bounded merged pagination needs a shared ordering

**Context**: While fixing #7534, replacing a database prefix read with an offset window initially assumed PostgreSQL name ordering matched Node `localeCompare`. Mixed case and Unicode names can violate that assumption and change valid pages.

**Rule**: Prove that every merged source uses the same comparator before skipping source rows. For workflows definitions, PostgreSQL `COLLATE "C"` and Node `Buffer.compare` over UTF-8 names agree, with DB id tie breaking and DB rows before equal-name code entries. Obtain authorization and document migration when adopting that policy changes existing ordering. Test mixed case, accented and supplementary Unicode characters, ties, empty pages and large offsets. A page-size or offset cap alone does not eliminate another provider's `offset + limit` prefix read.

**Applies to**: Any page assembled from database rows and in-memory or provider-defined entries.

Reject an offset beyond a supported ceiling instead of clamping it to another page: clamping repeats that page and can leave `hasMore` true forever. Preserve the normalized requested offset until every route caller has validated it, including claim-next consumers. Test the first rejected offset, the accepted ceiling and absence of provider reads or claims on rejected requests. Keep client migration instructions consistent across every affected caller. Page-size clamping does not have the same page-identity problem.
