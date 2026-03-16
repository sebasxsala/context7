import { describe, expect, test } from "vitest";
import {
  createCacheKey,
  endpointFromPath,
  getProvidedProxyKey,
  isProxyKeyAuthorized,
  resolveTtlSeconds,
} from "./cache-provider";

describe("cache provider helpers", () => {
  test("authorizes using PROXY_KEY env variable", () => {
    const headers = new Headers({ "x-context7-proxy-key": "my-secret" });
    const ok = isProxyKeyAuthorized(headers, { PROXY_KEY: "my-secret" });
    const rejected = isProxyKeyAuthorized(headers, { PROXY_KEY: "another-secret" });

    expect(ok).toBe(true);
    expect(rejected).toBe(false);
  });

  test("reads alias proxy header", () => {
    const headers = new Headers({ "x-proxy-key": "alias" });
    expect(getProvidedProxyKey(headers)).toBe("alias");
  });

  test("maps endpoint paths", () => {
    expect(endpointFromPath("/v2/libs/search")).toBe("search");
    expect(endpointFromPath("/v2/context")).toBe("context");
    expect(endpointFromPath("/other")).toBeNull();
  });

  test("resolves endpoint ttl values", () => {
    expect(resolveTtlSeconds("search", { SEARCH_CACHE_TTL_SECONDS: "120" })).toBe(120);
    expect(resolveTtlSeconds("context", { CACHE_TTL_SECONDS: "60" })).toBe(60);
  });

  test("builds deterministic cache key from request params", async () => {
    const request = new Request(
      "https://proxy.test/v2/context?libraryId=%2Ffacebook%2Freact&query=hooks&type=txt",
      {
        headers: {
          authorization: "Bearer ctx7sk-test",
        },
      }
    );

    const key1 = await createCacheKey(request, "context");
    const key2 = await createCacheKey(request, "context");

    expect(key1).toBe(key2);
    expect(key1.startsWith("ctx7:")).toBe(true);
  });
});
