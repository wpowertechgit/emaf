import { INTERNAL_SUBREQUEST_BUDGET, SUBREQUEST_BUDGET } from "./config";
import { ToolError } from "./util";

export class BudgetExceededError extends ToolError {
  constructor(limit: number) {
    super(
      `Subrequest budget exhausted (${limit} outbound calls per request). Narrow the request or split it into several calls.`,
    );
  }
}

/**
 * Tracks outbound calls made during one Worker invocation, in the two pools
 * Workers Free limits separately: 50 external subrequests (fetch) and 1,000
 * subrequests to Cloudflare services (KV, Workers AI). Tools plan ahead with
 * it and degrade gracefully instead of failing halfway.
 */
export class Budget {
  private usedCount = 0;
  private usedInternalCount = 0;

  constructor(
    readonly limit: number = SUBREQUEST_BUDGET,
    readonly internalLimit: number = INTERNAL_SUBREQUEST_BUDGET,
  ) {}

  /** External subrequests used. */
  get used(): number {
    return this.usedCount;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.usedCount);
  }

  /** Calls to Cloudflare services (KV, Workers AI) used. */
  get usedInternal(): number {
    return this.usedInternalCount;
  }

  get remainingInternal(): number {
    return Math.max(0, this.internalLimit - this.usedInternalCount);
  }

  /** Takes `n` external units if they are available. Returns false (and takes nothing) otherwise. */
  tryTake(n = 1): boolean {
    if (n > this.remaining) return false;
    this.usedCount += n;
    return true;
  }

  /** Takes `n` external units or throws BudgetExceededError. */
  take(n = 1): void {
    if (!this.tryTake(n)) throw new BudgetExceededError(this.limit);
  }

  /** Takes `n` units for calls to Cloudflare services if they are available. */
  tryTakeInternal(n = 1): boolean {
    if (n > this.remainingInternal) return false;
    this.usedInternalCount += n;
    return true;
  }

  /** Takes `n` units for calls to Cloudflare services or throws BudgetExceededError. */
  takeInternal(n = 1): void {
    if (!this.tryTakeInternal(n)) throw new BudgetExceededError(this.internalLimit);
  }

  /** A fetch that counts against the external budget. */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.take();
    return fetch(input, init);
  }
}
