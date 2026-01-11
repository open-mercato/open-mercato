-- Seed test products for QuoteWizard testing
-- Run with: PGPASSWORD=postgres psql -h localhost -U postgres -d open-mercato -f packages/fms/scripts/seed-test-products.sql

-- Variables (replace with your actual tenant and org IDs)
\set tenant_id '3dee5cd4-ab85-463e-9372-1ba7cf1fd4fb'
\set org_id 'e1263cce-5fbb-4df7-91d0-7bcd5bf7408a'

-- Set validity dates (1 year from now)
\set validity_start 'now()::date'
\set validity_end '(now() + interval ''1 year'')::date'

BEGIN;

-- =============================================
-- 1. Insert system charge codes
-- =============================================
INSERT INTO fms_charge_codes (id, organization_id, tenant_id, code, name, description, charge_unit, field_schema, sort_order, is_system, is_active)
VALUES
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GFRT', 'Freight Container', 'Ocean freight for containerized cargo', 'per_container', '{"loop": {"type": "string", "required": true, "label": "Service Loop"}, "source": {"type": "string", "required": true, "label": "Origin Port"}, "destination": {"type": "string", "required": true, "label": "Destination Port"}, "transitTime": {"type": "integer", "required": false, "label": "Transit Time", "unit": "days"}}', 1, true, true),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GBAF', 'Bunker Adjustment Factor (Container)', 'Fuel surcharge per container', 'per_container', '{}', 2, true, true),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GBOL', 'B/L (Bill of Lading)', 'Bill of Lading documentation fee', 'one_time', '{}', 4, true, true),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GTHC', 'Terminal Handling Charge', 'Terminal handling and container handling charges', 'per_container', '{"location": {"type": "string", "required": true, "label": "Location"}, "chargeType": {"type": "string", "required": false, "label": "Charge Type"}}', 5, true, true),
  (gen_random_uuid(), :'org_id', :'tenant_id', 'GCUS', 'Customs Clearance', 'Customs clearance and documentation services', 'one_time', '{"location": {"type": "string", "required": true, "label": "Location"}, "serviceType": {"type": "string", "required": false, "label": "Service Type"}}', 6, true, true)
ON CONFLICT DO NOTHING;

-- Get charge code IDs for reference
WITH charge_codes AS (
  SELECT id, code FROM fms_charge_codes
  WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
)

-- =============================================
-- 2. Insert products with variants and prices
-- =============================================

-- GFRT: MSC SWAN SHA-GDN Freight Product
, freight_product_1 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, loop, source, destination, transit_time, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'MSC SWAN SHA-GDN', cc.id, 'GFRT', 'MSC SWAN', 'SHA', 'GDN', 32, true
  FROM charge_codes cc WHERE cc.code = 'GFRT'
  RETURNING id
)
, freight_variant_1a AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'MSC Poland', '20GP', false, true
  FROM freight_product_1 p
  RETURNING id
)
, freight_price_1a_spot AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '1200.00', 'USD', true
  FROM freight_variant_1a v
  RETURNING id
)
, freight_price_1a_nac AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, contract_number, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'NAC', 'NAC-2024-001', '1100.00', 'USD', true
  FROM freight_variant_1a v
  RETURNING id
)
, freight_variant_1b AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'MSC Poland', '40HC', true, true
  FROM freight_product_1 p
  RETURNING id
)
, freight_price_1b_spot AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '2200.00', 'USD', true
  FROM freight_variant_1b v
  RETURNING id
)
, freight_price_1b_nac AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, contract_number, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'NAC', 'NAC-2024-001', '2000.00', 'USD', true
  FROM freight_variant_1b v
  RETURNING id
)

-- GFRT: CMA CGM PEARL SHA-GDN
, freight_product_2 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, loop, source, destination, transit_time, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'CMA CGM PEARL SHA-GDN', cc.id, 'GFRT', 'CMA CGM PEARL', 'SHA', 'GDN', 35, true
  FROM charge_codes cc WHERE cc.code = 'GFRT'
  RETURNING id
)
, freight_variant_2 AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'CMA CGM Poland', '40HC', true, true
  FROM freight_product_2 p
  RETURNING id
)
, freight_price_2 AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '2100.00', 'USD', true
  FROM freight_variant_2 v
  RETURNING id
)

-- GTHC: THC Shanghai Origin
, thc_product_1 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, location, charge_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'THC Shanghai Origin', cc.id, 'GTHC', 'SHA', 'origin', true
  FROM charge_codes cc WHERE cc.code = 'GTHC'
  RETURNING id
)
, thc_variant_1a AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '20GP', false, true
  FROM thc_product_1 p
  RETURNING id
)
, thc_price_1a AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '150.00', 'USD', true
  FROM thc_variant_1a v
  RETURNING id
)
, thc_variant_1b AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '40HC', true, true
  FROM thc_product_1 p
  RETURNING id
)
, thc_price_1b AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '200.00', 'USD', true
  FROM thc_variant_1b v
  RETURNING id
)

-- GTHC: THC Gdansk Destination
, thc_product_2 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, location, charge_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'THC Gdansk Destination', cc.id, 'GTHC', 'GDN', 'destination', true
  FROM charge_codes cc WHERE cc.code = 'GTHC'
  RETURNING id
)
, thc_variant_2a AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '20GP', false, true
  FROM thc_product_2 p
  RETURNING id
)
, thc_price_2a AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '180.00', 'EUR', true
  FROM thc_variant_2a v
  RETURNING id
)
, thc_variant_2b AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '40HC', true, true
  FROM thc_product_2 p
  RETURNING id
)
, thc_price_2b AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '250.00', 'EUR', true
  FROM thc_variant_2b v
  RETURNING id
)

-- GBAF: Bunker Adjustment Factor
, baf_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'Bunker Adjustment Factor', cc.id, 'GBAF', true
  FROM charge_codes cc WHERE cc.code = 'GBAF'
  RETURNING id
)
, baf_variant_a AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '20GP', false, true
  FROM baf_product p
  RETURNING id
)
, baf_price_a AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '350.00', 'USD', true
  FROM baf_variant_a v
  RETURNING id
)
, baf_variant_b AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, container_size, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'container', 'Default', '40HC', true, true
  FROM baf_product p
  RETURNING id
)
, baf_price_b AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '700.00', 'USD', true
  FROM baf_variant_b v
  RETURNING id
)

-- GBOL: Bill of Lading Fee
, bol_product AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'Bill of Lading Fee', cc.id, 'GBOL', true
  FROM charge_codes cc WHERE cc.code = 'GBOL'
  RETURNING id
)
, bol_variant AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'simple', 'Default', true, true
  FROM bol_product p
  RETURNING id
)
, bol_price AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '75.00', 'USD', true
  FROM bol_variant v
  RETURNING id
)

-- GCUS: Import Customs Clearance GDN
, cus_product_1 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, location, service_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'Import Customs Clearance GDN', cc.id, 'GCUS', 'GDN', 'import', true
  FROM charge_codes cc WHERE cc.code = 'GCUS'
  RETURNING id
)
, cus_variant_1 AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'simple', 'Default', true, true
  FROM cus_product_1 p
  RETURNING id
)
, cus_price_1 AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '250.00', 'EUR', true
  FROM cus_variant_1 v
  RETURNING id
)

-- GCUS: Export Customs Clearance SHA
, cus_product_2 AS (
  INSERT INTO fms_products (id, organization_id, tenant_id, name, charge_code_id, product_type, location, service_type, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', 'Export Customs Clearance SHA', cc.id, 'GCUS', 'SHA', 'export', true
  FROM charge_codes cc WHERE cc.code = 'GCUS'
  RETURNING id
)
, cus_variant_2 AS (
  INSERT INTO fms_product_variants (id, organization_id, tenant_id, product_id, variant_type, name, is_default, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', p.id, 'simple', 'Default', true, true
  FROM cus_product_2 p
  RETURNING id
)
, cus_price_2 AS (
  INSERT INTO fms_product_prices (id, organization_id, tenant_id, variant_id, validity_start, validity_end, contract_type, price, currency_code, is_active)
  SELECT gen_random_uuid(), :'org_id', :'tenant_id', v.id, :validity_start, :validity_end, 'SPOT', '150.00', 'USD', true
  FROM cus_variant_2 v
  RETURNING id
)

SELECT 'Test products seeded successfully!' as result;

COMMIT;

-- Show what was created
SELECT 'Charge Codes:' as entity, count(*) as count FROM fms_charge_codes WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Products:', count(*) FROM fms_products WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Variants:', count(*) FROM fms_product_variants WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id'
UNION ALL
SELECT 'Prices:', count(*) FROM fms_product_prices WHERE tenant_id = :'tenant_id' AND organization_id = :'org_id';
