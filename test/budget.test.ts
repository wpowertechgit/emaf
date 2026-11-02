import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, BudgetExceededError } from "../src/budget";
import { mockFetch } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Budget", () => {
  it("defaults to 45 of the 50 subrequests Workers Free allows", () => {
    expect(new Budget().limit).toBe(45);
  });

  it("counts takes and reports what remains", () => {
    const budget = new Budget(5);
    budget.take(2);
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(3);
  });

  it("tryTake takes nothing when the request does not fit", () => {
    const budget = new Budget(3);
    expect(budget.tryTake(2)).toBe(true);
    expect(budget.tryTake(2)).toBe(false);
    expect(budget.used).toBe(2);
    expect(budget.tryTake(1)).toBe(true);
    expect(budget.remaining).toBe(0);
  });

  it("take throws a tool error once exhausted", () => {
    const budget = new Budget(1);
    budget.take();
    expect(() => budget.take()).toThrow(BudgetExceededError);
    expect(() => budget.take()).toThrow(/Subrequest budget exhausted/);
  });

  it("counts every fetch and refuses to fetch past the limit", async () => {
    const mock = mockFetch({ "https://a.test/*": "ok" });
    const budget = new Budget(2);
    await budget.fetch("https://a.test/1");
    await budget.fetch("https://a.test/2");
    await expect(budget.fetch("https://a.test/3")).rejects.toThrow(BudgetExceededError);
    expect(mock.requested).toEqual(["https://a.test/1", "https://a.test/2"]);
    expect(budget.used).toBe(2);
  });
});
