import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogOffer,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { StoreContext } from './storeContext'

export type StorefrontCategoryNode = {
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  depth: number
  productCount: number
  children: StorefrontCategoryNode[]
}

export type StorefrontCategoryDetail = {
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  depth: number
  productCount: number
  ancestorIds: string[]
  childIds: string[]
}

export async function fetchStorefrontCategories(
  em: EntityManager,
  storeCtx: StoreContext,
): Promise<StorefrontCategoryNode[]> {
  const { organizationId, tenantId } = storeCtx

  const categories = await em.find(
    CatalogProductCategory,
    { organizationId, tenantId, isActive: true, deletedAt: null },
    { orderBy: { depth: 'asc', name: 'asc' } },
  )

  if (categories.length === 0) return []

  const categoryIds = categories.map((c) => c.id)
  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { category: { $in: categoryIds }, organizationId, tenantId },
    { fields: ['category', 'product'] },
  )
  const offeredProductsSet = storeCtx.channelBinding?.salesChannelId
    ? new Set(
        (
          await em.find(
            CatalogOffer,
            {
              organizationId,
              tenantId,
              channelId: storeCtx.channelBinding.salesChannelId,
              isActive: true,
              deletedAt: null,
            },
            { fields: ['product'] },
          )
        )
          .map((offer) =>
            typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null,
          )
          .filter((id): id is string => !!id),
      )
    : null

  const countByCategory = new Map<string, number>()
  for (const assignment of assignments) {
    const pid = typeof assignment.product === 'string' ? assignment.product : assignment.product?.id ?? null
    if (offeredProductsSet && (!pid || !offeredProductsSet.has(pid))) continue
    const cid = typeof assignment.category === 'string' ? assignment.category : assignment.category?.id ?? null
    if (!cid) continue
    countByCategory.set(cid, (countByCategory.get(cid) ?? 0) + 1)
  }

  const nodeMap = new Map<string, StorefrontCategoryNode>()
  for (const cat of categories) {
    nodeMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      slug: cat.slug ?? null,
      description: cat.description ?? null,
      parentId: cat.parentId ?? null,
      depth: cat.depth,
      productCount: countByCategory.get(cat.id) ?? 0,
      children: [],
    })
  }

  const roots: StorefrontCategoryNode[] = []
  for (const cat of categories) {
    const node = nodeMap.get(cat.id)!
    if (cat.parentId && nodeMap.has(cat.parentId)) {
      nodeMap.get(cat.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export async function fetchStorefrontCategoryBySlug(
  em: EntityManager,
  storeCtx: StoreContext,
  slug: string,
): Promise<StorefrontCategoryDetail | null> {
  const { organizationId, tenantId } = storeCtx

  const category = await em.findOne(CatalogProductCategory, {
    slug,
    organizationId,
    tenantId,
    isActive: true,
    deletedAt: null,
  })

  if (!category) return null

  const categoryIds = [category.id, ...category.descendantIds]
  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { category: { $in: categoryIds }, organizationId, tenantId },
    { fields: ['category', 'product'] },
  )
  const offeredProductsSet = storeCtx.channelBinding?.salesChannelId
    ? new Set(
        (
          await em.find(
            CatalogOffer,
            {
              organizationId,
              tenantId,
              channelId: storeCtx.channelBinding.salesChannelId,
              isActive: true,
              deletedAt: null,
            },
            { fields: ['product'] },
          )
        )
          .map((offer) =>
            typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null,
          )
          .filter((id): id is string => !!id),
      )
    : null

  const countByCategory = new Map<string, number>()
  for (const assignment of assignments) {
    const pid = typeof assignment.product === 'string' ? assignment.product : assignment.product?.id ?? null
    if (offeredProductsSet && (!pid || !offeredProductsSet.has(pid))) continue
    const cid = typeof assignment.category === 'string' ? assignment.category : assignment.category?.id ?? null
    if (!cid) continue
    countByCategory.set(cid, (countByCategory.get(cid) ?? 0) + 1)
  }

  const totalCount = Array.from(countByCategory.values()).reduce((sum, c) => sum + c, 0)

  return {
    id: category.id,
    name: category.name,
    slug: category.slug ?? null,
    description: category.description ?? null,
    parentId: category.parentId ?? null,
    depth: category.depth,
    productCount: totalCount,
    ancestorIds: category.ancestorIds,
    childIds: category.childIds,
  }
}
