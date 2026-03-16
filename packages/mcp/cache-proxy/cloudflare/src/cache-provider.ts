export type WorkerEnvLike = {
  CONTEXT7_PROXY_KEY?: string;
  PROXY_KEY?: string;
  CACHE_TTL_SECONDS?: string;
  SEARCH_CACHE_TTL_SECONDS?: string;
};

export type EndpointType = "search" | "context";

export type CachedPayload = {
  status: number;
  contentType: string;
  body: string;
  storedAt: number;
  ttlSeconds: number;
};

export interface CacheProvider {
  get(cacheKey: string): Promise<CachedPayload | null>;
  set(cacheKey: string, payload: CachedPayload): Promise<void>;
}

type KVLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export function getProvidedProxyKey(headers: Headers): string | undefined {
  return (
    headers.get("x-context7-proxy-key") ||
    headers.get("context7-proxy-key") ||
    headers.get("x-context7-cache-key") ||
    headers.get("context7-cache-key") ||
    headers.get("x-proxy-key") ||
    undefined
  );
}

export function isProxyKeyAuthorized(headers: Headers, env: WorkerEnvLike): boolean {
  const expected = env.CONTEXT7_PROXY_KEY || env.PROXY_KEY;
  if (!expected) {
    return true;
  }
  return getProvidedProxyKey(headers) === expected;
}

export function resolveTtlSeconds(endpoint: EndpointType, env: WorkerEnvLike): number {
  const parseTtl = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
  };

  if (endpoint === "search") {
    return parseTtl(env.SEARCH_CACHE_TTL_SECONDS, 21600);
  }

  return parseTtl(env.CACHE_TTL_SECONDS, 3600);
}

export function endpointFromPath(pathname: string): EndpointType | null {
  if (pathname === "/v2/libs/search") return "search";
  if (pathname === "/v2/context") return "context";
  return null;
}

function normalizeParams(url: URL): string {
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    entries.push([key, value]);
  });
  entries.sort(([a], [b]) => a.localeCompare(b));

  const normalized = new URLSearchParams();
  for (const [key, value] of entries) {
    if (key !== "cache") {
      normalized.append(key, value);
    }
  }

  return normalized.toString();
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createCacheKey(request: Request, endpoint: EndpointType): Promise<string> {
  const url = new URL(request.url);
  const normalized = normalizeParams(url);
  const authHash = await sha256Hex(request.headers.get("authorization") || "");
  const raw = `${endpoint}|${url.pathname}|${normalized}|${authHash}`;
  return `ctx7:${await sha256Hex(raw)}`;
}

function createEdgeRequest(cacheKey: string): Request {
  return new Request(`https://context7-cache.internal/${cacheKey}`, { method: "GET" });
}

export class CloudflareDualLayerCacheProvider implements CacheProvider {
  private cachePromise: Promise<Cache>;

  constructor(
    private readonly kv: KVLike,
    private readonly ttlSeconds: number
  ) {
    this.cachePromise = caches.open("context7-proxy");
  }

  async get(cacheKey: string): Promise<CachedPayload | null> {
    const edgeCache = await this.cachePromise;
    const edgeResponse = await edgeCache.match(createEdgeRequest(cacheKey));

    if (edgeResponse) {
      const body = await edgeResponse.text();
      const contentType = edgeResponse.headers.get("content-type") || "text/plain; charset=utf-8";
      return {
        status: edgeResponse.status,
        contentType,
        body,
        storedAt: Date.now(),
        ttlSeconds: this.ttlSeconds,
      };
    }

    const kvPayload = await this.kv.get(cacheKey, "json");
    if (!kvPayload || typeof kvPayload !== "object") {
      return null;
    }

    const parsed = kvPayload as CachedPayload;
    const expiresAt = parsed.storedAt + parsed.ttlSeconds * 1000;
    if (Date.now() >= expiresAt) {
      return null;
    }

    await edgeCache.put(createEdgeRequest(cacheKey), this.toEdgeResponse(parsed));
    return parsed;
  }

  async set(cacheKey: string, payload: CachedPayload): Promise<void> {
    const edgeCache = await this.cachePromise;
    await Promise.all([
      edgeCache.put(createEdgeRequest(cacheKey), this.toEdgeResponse(payload)),
      this.kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: payload.ttlSeconds }),
    ]);
  }

  private toEdgeResponse(payload: CachedPayload): Response {
    return new Response(payload.body, {
      status: payload.status,
      headers: {
        "content-type": payload.contentType,
        "cache-control": `public, max-age=${payload.ttlSeconds}`,
      },
    });
  }
}
