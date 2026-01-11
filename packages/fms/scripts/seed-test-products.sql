-- Seed test products for QuoteWizard testing
-- Run with: PGPASSWORD=postgres psql -h localhost -U postgres -d open-mercato -f packages/fms/scripts/seed-test-products.sql

-- Variables (replace with your actual tenant and org IDs)
\set tenant_id '3dee5cd4-ab85-463e-9372-1ba7cf1fd4fb'
\set org_id 'e1263cce-5fbb-4df7-91d0-7bcd5bf7408a'

BEGIN;

-- =============================================
-- 1. Create test contractor (service provider)
-- =============================================
INSERT INTO contractors (id, organization_id, tenant_id, name, short_name, is_active, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', :'org_id', :'tenant_id', 'MSC Mediterranean Shipping Company', 'MSC', true, now(), now()),
  ('22222222-2222-2222-2222-222222222222', :'org_id', :'tenant_id', 'CMA CGM', 'CMA CGM', true, now(), now()),
  ('33333333-3333-3333-3333-333333333333', :'org_id', :'tenant_id', 'Default Provider', 'Default', true, now(), now())
ON CONFLICT DO NOTHING;

-- =============================================
-- 2. Get location IDs
-- =============================================
-- Find Shanghai and Gdansk locations
DO $$
DECLARE
  v_sha_id uuid;
  v_gdn_id uuid;
BEGIN
  SELECT id INTO v_sha_id FROM fms_locations WHERE code = 'CNSHA' LIMIT 1;
  SELECT id INTO v_gdn_id FROM fms_locations WHERE code = 'PLGDN' LIMIT 1;

  IF v_sha_id IS NULL THEN
    RAISE NOTICE 'Shanghai location not found, creating...';
    INSERT INTO fms_locations (id, organization_id, tenant_id, code, name, country_code, location_type, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), 'e1263cce-5fbb-4df7-91d0-7bcd5bf7408a', '3dee5cd4-ab85-463e-9372-1ba7cf1fd4fb', 'CNSHA', 'Port of Shanghai', 'CN', 'port', true, now(), now())
    RETURNING id INTO v_sha_id;
  END IF;

  IF v_gdn_id IS NULL THEN
    RAISE NOTICE 'Gdansk location not found, creating...';
    INSERT INTO fms_locations (id, organization_id, tenant_id, code, name, country_code, location_type, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), 'e1263cce-5fbb-4df7-91d0-7bcd5bf7408a', '3dee5cd4-ab85-463e-9372-1ba7cf1fd4fb', 'PLGDN', 'Port of Gdansk', 'PL', 'port', true, now(), now())
    RETURNING id INTO v_gdn_id;
  END IF;
END $$;

-- =============================================
-- 3. Insert charge codes
-- =============================================
INSERT INTO fms_charge_codes (id, organization_id, tenant_id, code, description, charge_unit, field_schema, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GFRT', 'Ocean freight for containerized cargo', 'per_container', '{}', true, now(), now()),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GBAF', 'Fuel surcharge per container', 'per_container', '{}', true, now(), now()),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GBOL', 'Bill of Lading documentation fee', 'one_time', '{}', true, now(), now()),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GTHC', 'Terminal handling charges', 'per_container', '{}', true, now(), now()),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GCUS', 'Customs clearance services', 'one_time', '{}', true, now(), now())
ON CONFLICT DO NOTHING;

-- =============================================
-- 4. Insert products with variants and prices
-- =============================================

-- Create temp tables to hold IDs
CREATE TEMP TABLE temp_ids (
  entity_type text,
  entity_name text,
  entity_id uuid
);

-- Get charge code IDs
INSERT INTO temp_ids (entity_type, entity_name, entity_id)
SELECT 'charge_code', code, id FROM fms_charge_codes
WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id';

-- Get location IDs
INSERT INTO temp_ids (entity_type, entity_name, entity_id)
SELECT 'location', code, id FROM fms_locations
WHERE code IN ('CNSHA', 'PLGDN') LIMIT 2;

-- GFRT: MSC SWAN SHA-GDN Freight Product
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, loop, source_id, destination_id, transit_time, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'MSC SWAN SHA-GDN',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GFRT'),
    '11111111-1111-1111-1111-111111111111',
    'GFRT',
    'MSC SWAN',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'CNSHA'),
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'PLGDN'),
    32,
    true,
    now(),
    now()
  RETURNING id
),
new_variant_20gp AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '11111111-1111-1111-1111-111111111111', 'MSC Poland 20GP', 'container', '20GP', false, true, now(), now()
  FROM new_product
  RETURNING id
),
new_variant_40hc AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '11111111-1111-1111-1111-111111111111', 'MSC Poland 40HC', 'container', '40HC', true, true, now(), now()
  FROM new_product
  RETURNING id
),
price_20gp_spot AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '1200.00', 'USD', true, now(), now()
  FROM new_variant_20gp
  RETURNING id
),
price_20gp_nac AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, contract_number, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'NAC', 'NAC-2024-001', '1100.00', 'USD', true, now(), now()
  FROM new_variant_20gp
  RETURNING id
),
price_40hc_spot AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '2200.00', 'USD', true, now(), now()
  FROM new_variant_40hc
  RETURNING id
),
price_40hc_nac AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, contract_number, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'NAC', 'NAC-2024-001', '2000.00', 'USD', true, now(), now()
  FROM new_variant_40hc
  RETURNING id
)
SELECT 1;

-- GFRT: CMA CGM PEARL SHA-GDN
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, loop, source_id, destination_id, transit_time, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'CMA CGM PEARL SHA-GDN',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GFRT'),
    '22222222-2222-2222-2222-222222222222',
    'GFRT',
    'CMA CGM PEARL',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'CNSHA'),
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'PLGDN'),
    35,
    true,
    now(),
    now()
  RETURNING id
),
new_variant AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '22222222-2222-2222-2222-222222222222', 'CMA CGM Poland 40HC', 'container', '40HC', true, true, now(), now()
  FROM new_product
  RETURNING id
),
new_price AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '2100.00', 'USD', true, now(), now()
  FROM new_variant
  RETURNING id
)
SELECT 1;

-- GTHC: THC Shanghai Origin
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, location_id, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'THC Shanghai Origin',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GTHC'),
    '33333333-3333-3333-3333-333333333333',
    'GTHC',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'CNSHA'),
    true,
    now(),
    now()
  RETURNING id
),
new_variant_20gp AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 20GP', 'container', '20GP', false, true, now(), now()
  FROM new_product
  RETURNING id
),
new_variant_40hc AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 40HC', 'container', '40HC', true, true, now(), now()
  FROM new_product
  RETURNING id
),
price_20gp AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '150.00', 'USD', true, now(), now()
  FROM new_variant_20gp
  RETURNING id
),
price_40hc AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '200.00', 'USD', true, now(), now()
  FROM new_variant_40hc
  RETURNING id
)
SELECT 1;

-- GTHC: THC Gdansk Destination
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, location_id, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'THC Gdansk Destination',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GTHC'),
    '33333333-3333-3333-3333-333333333333',
    'GTHC',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'PLGDN'),
    true,
    now(),
    now()
  RETURNING id
),
new_variant_20gp AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 20GP', 'container', '20GP', false, true, now(), now()
  FROM new_product
  RETURNING id
),
new_variant_40hc AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 40HC', 'container', '40HC', true, true, now(), now()
  FROM new_product
  RETURNING id
),
price_20gp AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '180.00', 'EUR', true, now(), now()
  FROM new_variant_20gp
  RETURNING id
),
price_40hc AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '250.00', 'EUR', true, now(), now()
  FROM new_variant_40hc
  RETURNING id
)
SELECT 1;

-- GBAF: Bunker Adjustment Factor
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'Bunker Adjustment Factor',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GBAF'),
    '33333333-3333-3333-3333-333333333333',
    'GBAF',
    true,
    now(),
    now()
  RETURNING id
),
new_variant_20gp AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 20GP', 'container', '20GP', false, true, now(), now()
  FROM new_product
  RETURNING id
),
new_variant_40hc AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, container_size, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default 40HC', 'container', '40HC', true, true, now(), now()
  FROM new_product
  RETURNING id
),
price_20gp AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '350.00', 'USD', true, now(), now()
  FROM new_variant_20gp
  RETURNING id
),
price_40hc AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '700.00', 'USD', true, now(), now()
  FROM new_variant_40hc
  RETURNING id
)
SELECT 1;

-- GBOL: Bill of Lading Fee
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'Bill of Lading Fee',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GBOL'),
    '33333333-3333-3333-3333-333333333333',
    'GBOL',
    true,
    now(),
    now()
  RETURNING id
),
new_variant AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default', 'simple', true, true, now(), now()
  FROM new_product
  RETURNING id
),
new_price AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '75.00', 'USD', true, now(), now()
  FROM new_variant
  RETURNING id
)
SELECT 1;

-- GCUS: Import Customs Clearance GDN
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, location_id, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'Import Customs Clearance GDN',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GCUS'),
    '33333333-3333-3333-3333-333333333333',
    'GCUS',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'PLGDN'),
    true,
    now(),
    now()
  RETURNING id
),
new_variant AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default', 'simple', true, true, now(), now()
  FROM new_product
  RETURNING id
),
new_price AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '250.00', 'EUR', true, now(), now()
  FROM new_variant
  RETURNING id
)
SELECT 1;

-- GCUS: Export Customs Clearance SHA
WITH new_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, service_provider_id, product_type, location_id, is_active, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    :'org_id',
    :'tenant_id',
    'Export Customs Clearance SHA',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'charge_code' AND entity_name = 'GCUS'),
    '33333333-3333-3333-3333-333333333333',
    'GCUS',
    (SELECT entity_id FROM temp_ids WHERE entity_type = 'location' AND entity_name = 'CNSHA'),
    true,
    now(),
    now()
  RETURNING id
),
new_variant AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, provider_id, name, variant_type, is_default, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, '33333333-3333-3333-3333-333333333333', 'Default', 'simple', true, true, now(), now()
  FROM new_product
  RETURNING id
),
new_price AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active, created_at, updated_at)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', id, now()::date, (now() + interval '1 year')::date, 'SPOT', '150.00', 'USD', true, now(), now()
  FROM new_variant
  RETURNING id
)
SELECT 1;

-- Clean up temp table
DROP TABLE temp_ids;

COMMIT;

-- Show what was created
SELECT 'Contractors:' as entity, count(*) as count FROM contractors WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Charge Codes:', count(*) FROM fms_charge_codes WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Products:', count(*) FROM fms_products WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Variants:', count(*) FROM fms_product_variants WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Prices:', count(*) FROM fms_product_prices WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id';
