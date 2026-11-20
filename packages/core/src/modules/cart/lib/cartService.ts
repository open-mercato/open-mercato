import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { lockCartCommand, markConvertedCommand, unlockCartCommand } from '../commands/lock'
import type {
  CartLockInput,
  CartLockResult,
  CartMarkConvertedInput,
  CartMarkConvertedResult,
  CartUnlockInput,
  CartUnlockResult,
} from '../commands/lock'

// Step 7.5 — §9/§3.1a's own prose repeatedly says `cartService.lock`/`.unlock`/
// `.markConverted` ("checkout calls the DI service/command directly, in-process") — but
// this module has never built an actual `cartService` class before this step; every other
// "service-shaped" capability here is a plain command dispatched via
// `commandBus.execute(...)`. Mirrors `promotions/lib/promotions-service.ts`'s
// `PromotionsServiceImpl` (Step 2.6) at this module's own much smaller scale: a thin class
// wrapping `container.resolve('commandBus').execute(...)` per method, so the spec's own
// named call shape is real and callable for whenever `checkout` lands. The commands in
// `commands/lock.ts` remain the actual source of truth — this facade adds no logic of its
// own beyond resolving the command bus and building a minimal `CommandRuntimeContext`.

export type CartServiceContainer = {
  resolve: <T = unknown>(name: string) => T
}

export type CartService = {
  lock(input: CartLockInput): Promise<CartLockResult>
  unlock(input: CartUnlockInput): Promise<CartUnlockResult>
  markConverted(input: CartMarkConvertedInput): Promise<CartMarkConvertedResult>
}

type CartServiceAuthContext = CommandRuntimeContext['auth']

// Same "resolve `auth` off whatever is registered on the container, tolerate it being
// absent" convention `promotions-service.ts`'s `resolvePromotionsServiceScope` documents at
// length — unlike that facade, none of `cart.lock`/`.unlock`/`.markConverted` read
// `ctx.auth` themselves (every scope field they need arrives explicitly on the command
// input, since `checkout`, the only intended caller, already has its own resolved
// tenant/organization by the time it reaches this facade), so a missing `auth` token is not
// a failure here — it only affects the command bus's own interceptor/audit attribution.
function resolveCartServiceAuth(container: CartServiceContainer): CartServiceAuthContext {
  try {
    return (container.resolve<CartServiceAuthContext>('auth') ?? null) as CartServiceAuthContext
  } catch {
    return null
  }
}

function buildCartServiceCommandContext(
  container: CartServiceContainer,
  input: { tenantId: string; organizationId: string },
): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: resolveCartServiceAuth(container),
    organizationScope: null,
    selectedOrganizationId: input.organizationId,
    organizationIds: [input.organizationId],
  }
}

function resolveCartServiceCommandBus(container: CartServiceContainer): CommandBus {
  return container.resolve<CommandBus>('commandBus')
}

export class CartServiceImpl implements CartService {
  constructor(private readonly container: CartServiceContainer) {}

  async lock(input: CartLockInput): Promise<CartLockResult> {
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, input)
    const { result } = await commandBus.execute<CartLockInput, CartLockResult>(lockCartCommand.id, { input, ctx })
    return result
  }

  async unlock(input: CartUnlockInput): Promise<CartUnlockResult> {
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, input)
    const { result } = await commandBus.execute<CartUnlockInput, CartUnlockResult>(unlockCartCommand.id, { input, ctx })
    return result
  }

  async markConverted(input: CartMarkConvertedInput): Promise<CartMarkConvertedResult> {
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, input)
    const { result } = await commandBus.execute<CartMarkConvertedInput, CartMarkConvertedResult>(
      markConvertedCommand.id,
      { input, ctx },
    )
    return result
  }
}
