import { describe, expect, test } from "vitest";
import { enforceRateLimit, getRateLimitConfig } from "./rate-limit";

type KVRecord = { value: string; expiresAt?: number };

class InMemoryKV {
  private map = new Map<string, KVRecord>();

  async get(key: string, type: "json"): Promise<unknown> {
    const record = this.map.get(key);
    if (!record) return null;

    if (record.expiresAt && Date.now() >= record.expiresAt) {
      this.map.delete(key);
      return null;
    }

    if (type === "json") {
      return JSON.parse(record.value);
    }

    return record.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined,
    });
  }
}

describe("rate limit", () => {
  test("uses defaults when env is missing", () => {
    const cfg = getRateLimitConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxRequests).toBe(120);
    expect(cfg.windowSeconds).toBe(60);
  });

  test("can be disabled by env", async () => {
    const kv = new InMemoryKV();
    const request = new Request("https://proxy.test/v2/context", {
      headers: { authorization: "Bearer ctx7sk-test" },
    });

    const result = await enforceRateLimit(request, "context", { RATE_LIMIT_ENABLED: "false" }, kv);

    expect(result.allowed).toBe(true);
    expect(result.headers.get("x-ratelimit-limit")).toBeNull();
  });

  test("rejects requests above configured threshold", async () => {
    const kv = new InMemoryKV();
    const env = {
      RATE_LIMIT_MAX_REQUESTS: "2",
      RATE_LIMIT_WINDOW_SECONDS: "60",
    };
    const request = new Request("https://proxy.test/v2/libs/search?query=react&libraryName=react", {
      headers: { authorization: "Bearer ctx7sk-test" },
    });

    const first = await enforceRateLimit(request, "search", env, kv);
    const second = await enforceRateLimit(request, "search", env, kv);
    const third = await enforceRateLimit(request, "search", env, kv);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.headers.get("retry-after")).not.toBeNull();
  });
});
