import {
  CloudflareDualLayerCacheProvider,
  createCacheKey,
  endpointFromPath,
  isProxyKeyAuthorized,
  resolveTtlSeconds,
  type CachedPayload,
  type WorkerEnvLike,
} from "./cache-provider";
import { enforceRateLimit, type RateLimitEnvLike } from "./rate-limit";

type Env = WorkerEnvLike &
  RateLimitEnvLike & {
    CONTEXT7_KV: {
      get(key: string, type: "json"): Promise<unknown>;
      put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    };
  };

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

const CONTEXT7_API_BASE_URL = "https://context7.com/api";

function corsHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  next.set("Access-Control-Allow-Origin", "*");
  next.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  next.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Context7-Proxy-Key, Context7-Proxy-Key, X-Context7-Cache-Key, Context7-Cache-Key, X-Proxy-Key, X-Context7-Cache-Bypass"
  );
  next.set("Access-Control-Expose-Headers", "X-Context7-Cache, X-Context7-Cache-Key");
  return next;
}

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: corsHeaders({ "content-type": "application/json" }),
  });
}

function shouldBypassCache(request: Request): boolean {
  const bypassHeader = request.headers.get("x-context7-cache-bypass");
  if (bypassHeader === "true" || bypassHeader === "1") {
    return true;
  }
  const url = new URL(request.url);
  const bypassQuery = url.searchParams.get("cache");
  return bypassQuery === "0" || bypassQuery === "false";
}

function getForwardHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("x-context7-proxy-key");
  headers.delete("context7-proxy-key");
  headers.delete("x-context7-cache-key");
  headers.delete("context7-cache-key");
  headers.delete("x-proxy-key");
  headers.delete("x-context7-cache-bypass");
  return headers;
}

function responseWithCacheHeaders(
  response: Response,
  cacheKey: string,
  cacheState: string,
  extraHeaders?: Headers
): Response {
  const headers = new Headers(response.headers);
  headers.set("x-context7-cache", cacheState);
  headers.set("x-context7-cache-key", cacheKey);
  if (extraHeaders) {
    extraHeaders.forEach((value, key) => headers.set(key, value));
  }
  return new Response(response.body, { status: response.status, headers: corsHeaders(headers) });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return jsonError(405, "method_not_allowed", "Only GET requests are supported.");
    }

    if (!isProxyKeyAuthorized(request.headers, env)) {
      return jsonError(401, "unauthorized", "Invalid proxy key.");
    }

    const requestUrl = new URL(request.url);
    const endpoint = endpointFromPath(requestUrl.pathname);
    if (!endpoint) {
      return jsonError(
        404,
        "not_found",
        "Supported endpoints are /v2/libs/search and /v2/context."
      );
    }

    const rateLimit = await enforceRateLimit(request, endpoint, env, env.CONTEXT7_KV);
    if (!rateLimit.allowed) {
      const headers = new Headers({ "content-type": "application/json" });
      rateLimit.headers.forEach((value, key) => headers.set(key, value));
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "Rate limit exceeded. Please retry after the configured window.",
        }),
        {
          status: 429,
          headers: corsHeaders(headers),
        }
      );
    }

    const cacheKey = await createCacheKey(request, endpoint);
    const ttlSeconds = resolveTtlSeconds(endpoint, env);
    const bypassCache = shouldBypassCache(request);
    const provider = new CloudflareDualLayerCacheProvider(env.CONTEXT7_KV, ttlSeconds);

    if (!bypassCache) {
      const cached = await provider.get(cacheKey);
      if (cached) {
        return responseWithCacheHeaders(
          new Response(cached.body, {
            status: cached.status,
            headers: { "content-type": cached.contentType },
          }),
          cacheKey,
          "HIT",
          rateLimit.headers
        );
      }
    }

    const upstreamUrl = new URL(`${CONTEXT7_API_BASE_URL}${requestUrl.pathname}`);
    requestUrl.searchParams.forEach((value, key) => {
      if (key !== "cache") {
        upstreamUrl.searchParams.append(key, value);
      }
    });

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: getForwardHeaders(request),
    });

    if (!upstreamResponse.ok || bypassCache) {
      return responseWithCacheHeaders(
        upstreamResponse,
        cacheKey,
        bypassCache ? "BYPASS" : "MISS",
        rateLimit.headers
      );
    }

    const body = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") || "text/plain; charset=utf-8";
    const payload: CachedPayload = {
      status: upstreamResponse.status,
      contentType,
      body,
      storedAt: Date.now(),
      ttlSeconds,
    };

    ctx.waitUntil(provider.set(cacheKey, payload));

    return responseWithCacheHeaders(
      new Response(body, {
        status: upstreamResponse.status,
        headers: { "content-type": contentType },
      }),
      cacheKey,
      "MISS",
      rateLimit.headers
    );
  },
};
