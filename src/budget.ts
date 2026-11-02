import { SUBREQUEST_BUDGET } from "./config";
import { ToolError } from "./util";

export class BudgetExceededError extends ToolError {
  constructor(limit: number) {
    super(
      `Subrequest budget exhausted (${limit} outbound calls per request). Narrow the request or split it into several calls.`,
    );
  }
}

/**
 * Tracks outbound calls made during one Worker invocation. Workers Free allows
 * 50 subrequests per invocation; every fetch and every binding call that may
 * count against that limit goes through a Budget so tools can plan ahead and
 * degrade gracefully instead of failing halfway.
 */
export class Budget {
  private usedCount = 0;

  constructor(readonly limit: number = SUBREQUEST_BUDGET) {}

  get used(): number {
    return this.usedCount;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.usedCount);
  }

  /** Takes `n` units if they are available. Returns false (and takes nothing) otherwise. */
  tryTake(n = 1): boolean {
    if (n > this.remaining) return false;
    this.usedCount += n;
    return true;
  }

  /** Takes `n` units or throws BudgetExceededError. */
  take(n = 1): void {
    if (!this.tryTake(n)) throw new BudgetExceededError(this.limit);
  }

  /** A fetch that counts against the budget. */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.take();
    return fetch(input, init);
  }
}
