import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'sales:orders',
      requiredFeatures: ['sales.orders.view'],
      entityConfig: {
        tableName: 'sales_orders',
        dateField: 'placed_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        grandTotalGrossAmount: { dbColumn: 'grand_total_gross_amount', type: 'numeric' },
        grandTotalNetAmount: { dbColumn: 'grand_total_net_amount', type: 'numeric' },
        subtotalGrossAmount: { dbColumn: 'subtotal_gross_amount', type: 'numeric' },
        subtotalNetAmount: { dbColumn: 'subtotal_net_amount', type: 'numeric' },
        discountTotalAmount: { dbColumn: 'discount_total_amount', type: 'numeric' },
        taxTotalAmount: { dbColumn: 'tax_total_amount', type: 'numeric' },
        lineItemCount: { dbColumn: 'line_item_count', type: 'numeric' },
        status: { dbColumn: 'status', type: 'text' },
        fulfillmentStatus: { dbColumn: 'fulfillment_status', type: 'text' },
        paymentStatus: { dbColumn: 'payment_status', type: 'text' },
        customerEntityId: { dbColumn: 'customer_entity_id', type: 'uuid' },
        channelId: { dbColumn: 'channel_id', type: 'uuid' },
        placedAt: { dbColumn: 'placed_at', type: 'timestamp' },
        currencyCode: { dbColumn: 'currency_code', type: 'text' },
        shippingAddressSnapshot: { dbColumn: 'shipping_address_snapshot', type: 'jsonb' },
      },
      labelResolvers: {
        customerEntityId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
        channelId: { table: 'sales_channels', idColumn: 'id', labelColumn: 'name' },
      },
    },
    {
      entityId: 'sales:order_lines',
      requiredFeatures: ['sales.orders.view'],
      entityConfig: {
        tableName: 'sales_order_lines',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        totalGrossAmount: { dbColumn: 'total_gross_amount', type: 'numeric' },
        totalNetAmount: { dbColumn: 'total_net_amount', type: 'numeric' },
        unitGrossPrice: { dbColumn: 'unit_gross_price', type: 'numeric' },
        quantity: { dbColumn: 'quantity', type: 'numeric' },
        productId: { dbColumn: 'product_id', type: 'uuid' },
        productVariantId: { dbColumn: 'product_variant_id', type: 'uuid' },
        status: { dbColumn: 'status', type: 'text' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
      labelResolvers: {
        productId: { table: 'catalog_products', idColumn: 'id', labelColumn: 'title' },
        productVariantId: { table: 'catalog_product_variants', idColumn: 'id', labelColumn: 'name' },
      },
    },
  ],
}

export default analyticsConfig
export const config = analyticsConfig
