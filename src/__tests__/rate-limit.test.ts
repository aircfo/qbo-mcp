import { describe, expect, it } from "vitest";
import { RateLimiter } from "../rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to max requests within the window, then denies", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 100).allowed).toBe(true);
    expect(rl.check("a", 200).allowed).toBe(true);
    const denied = rl.check("a", 300);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(700);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("b", 0).allowed).toBe(true);
    expect(rl.check("a", 0).allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 500).allowed).toBe(false);
    expect(rl.check("a", 1000).allowed).toBe(true);
  });

  it("sweep drops only expired windows", () => {
    const rl = new RateLimiter(1, 1000);
    rl.check("old", 0);
    rl.check("fresh", 900);
    rl.sweep(1000);
    // 'old' expired (resetAt 1000 <= 1000) → fresh window on next check
    expect(rl.check("old", 1000).allowed).toBe(true);
    // 'fresh' still within its window (resetAt 1900) → denied
    expect(rl.check("fresh", 1000).allowed).toBe(false);
  });
});
