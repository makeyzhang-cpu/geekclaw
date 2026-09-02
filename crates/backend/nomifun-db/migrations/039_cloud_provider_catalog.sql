-- Cloud-managed model provider catalog.
--
-- Admin configures providers (with credentials) in the central web backend
-- (geekclaw.ai); subscribed/eligible members pull them down to their desktop
-- client via the sync endpoint, where they land as read-only `source = 'cloud'`
-- providers. This implements the commercial "configured for you" model: members
-- use the provider without ever seeing or managing the API key.
--
-- `provider_key` is the stable cross-device dedup key (e.g. a slug like
-- "geekclawai"). `api_key_encrypted` is encrypted at rest with the cloud's
-- data-encryption key; the member endpoint decrypts and returns the plaintext
-- over the authenticated TLS channel for the desktop to re-encrypt locally.
CREATE TABLE cloud_provider_catalog (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_key       TEXT NOT NULL UNIQUE
                       CHECK (trim(provider_key) <> ''),
    name               TEXT NOT NULL,
    platform           TEXT NOT NULL,
    base_url           TEXT NOT NULL,
    api_key_encrypted  TEXT NOT NULL,
    is_public          INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
    is_full_url        INTEGER NOT NULL DEFAULT 0 CHECK (is_full_url IN (0, 1)),
    models             TEXT NOT NULL DEFAULT '[]',
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX idx_cloud_provider_catalog_sort ON cloud_provider_catalog(sort_order, provider_key);

-- Extend the local `providers` table with cloud-sync provenance so synced
-- rows are distinguishable from user-created ones and can be re-upserted
-- idempotently by `cloud_key` (and pruned when removed server-side).
ALTER TABLE providers ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE providers ADD COLUMN cloud_key TEXT;
CREATE UNIQUE INDEX idx_providers_cloud_key ON providers(cloud_key) WHERE cloud_key IS NOT NULL;
