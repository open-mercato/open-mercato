# Hiding a server-required field

A configured form blocks editing and mutation controls when an override removes a server-required value without covering it. Decide how the authoritative command will still receive that value before publishing the override.

- On create, supply an explicit [server default](../../form-sections.ts) or emit the field from an accepted replacement.
- On edit, preserve the value read from the locked record or emit it from the accepted section. Keep the existing version check on the parent write.
- Keep the original server validator and return a localized, reachable error. A client initial value alone supplies no server coverage.

The Todo showcase demonstrates the same required title in both variants. Its create policy declares the default in the extension, and its update adapter reads the original title inside the command transaction. The negative integration fixture checks the blocking state and the absence of mutation controls.
