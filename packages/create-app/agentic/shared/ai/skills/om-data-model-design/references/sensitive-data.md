# Sensitive Data

Load this reference when records contain PII, credentials, addresses, contact information, personal notes, or regulated data.

1. Classify data sensitivity, lookup needs, retention/deletion, logs/search/export exposure, and access features.
2. Declare fields in module `encryption.ts` `defaultEncryptionMaps`; use a sibling hash field only for deterministic equality lookup.
3. Read through the framework decryption helpers with tenant and organization scope. Audit list/detail/export/search/worker/CLI paths for raw ORM reads.
4. Keep secrets out of responses, logs, errors, events, snapshots, cache keys, search documents, and test artifacts.
5. Seed/update encryption configuration through the supported command when required; never hand-roll KMS/AES.
6. Test authorized decryption, cross-scope denial, redaction, missing keys, export/search behavior, and cleanup/retention.
