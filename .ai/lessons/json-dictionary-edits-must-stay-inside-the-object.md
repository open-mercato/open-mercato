---
title: "A line-based script that writes a tracked JSON dictionary must insert inside the object"
modules: ["hr_management","create_app"]
areas: ["debugging","module-data","testing"]
topics: ["generated-files","regeneration","error-states"]
---

# A line-based script that writes a tracked JSON dictionary must insert inside the object

Adding 78 dictionary keys to six locale files with a helper script left one locale unparseable, and the
only reason the damage stopped there is that the script verifies each file right after writing it.

## What the script got wrong

Two assumptions about the file's shape, both false for a file that ends with a newline:

| Assumption | Reality | Result |
|---|---|---|
| `lines.length - 1` is the line before the closing brace | the split leaves a trailing empty element, so it points *after* `}` | new keys landed outside the object |
| the line at the insertion point can simply take a comma | the previously-last property has no comma, because it was last | a key followed another with no separator |

Both produce the same symptom — `Unexpected non-whitespace character after JSON` at a line the diff
never touched — and `git diff --stat` still reads as "one file changed, N insertions", which is the
part that makes it look harmless.

## The habits that kept it contained

- **Verify after every write, per file, before moving on.** The parse failure aborted the loop, so the
  four locales the script had not reached were never touched. Writing all six and verifying at the end
  would have left six broken files.
- **Recover from `git show HEAD:<file>`, not from the working copy.** The mirror locales took their
  committed contents as the base and inherited the new English values; a partially written working copy
  must never be the base of a repair.
- **Rebuild rather than patch.** A rebuild that reads every `"key": value` pair anywhere in the text,
  keeps the last value per key and re-serialises sorted is idempotent and needs no knowledge of which
  line was broken.
- A dictionary is *whole* or it is wrong: a module's `ar.json` must carry every key, so a partial write
  is worse than no write (`scripts/i18n-check-sync.ts` treats a shipped locale as a checked locale).

## Rules

- Insert before the index of the closing `}` (found by scanning), not at `length - 1`; ensure the line
  at the insertion point ends with a comma first.
- Re-serialise dictionaries from parsed data instead of splicing lines whenever the tooling allows it.
- Run the project's own gate (`yarn i18n:check-sync`) after touching any dictionary, even when the files
  parse: it also checks key parity, flatness and sort order.
