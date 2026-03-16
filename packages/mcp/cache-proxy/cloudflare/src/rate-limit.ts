import { sha256Hex, type EndpointType } from "./cache-provider";

type KVLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type RateLimitEnvLike = {
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
};

type RateLimitRecord = {
  count: number;
  windowStartMs: number;
};

export type RateLimitConfig = {
  enabled: boolean;
  maxRequests: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  headers: Headers;
};

const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_WINDOW_SECONDS = 60;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

export function getRateLimitConfig(env: RateLimitEnvLike): RateLimitConfig {
  return {
    enabled: parseBoolean(env.RATE_LIMIT_ENABLED, true),
    maxRequests: parsePositiveInteger(env.RATE_LIMIT_MAX_REQUESTS, DEFAULT_MAX_REQUESTS),
    windowSeconds: parsePositiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

function getClientIdentitySource(request: Request): string {
  const auth = request.headers.get("authorization");
  if (auth) {
    return `auth:${auth}`;
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return `ip:${cfConnectingIp}`;
  }

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    return `ip:${xff.split(",")[0].trim()}`;
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) {
    return `ip:${xRealIp}`;
  }

  return "anonymous";
}

function rateLimitHeaders(limit: number, remaining: number, resetEpochSeconds: number): Headers {
  const headers = new Headers();
  headers.set("x-ratelimit-limit", String(limit));
  headers.set("x-ratelimit-remaining", String(Math.max(remaining, 0)));
  headers.set("x-ratelimit-reset", String(resetEpochSeconds));
  return headers;
}

export async function enforceRateLimit(
  request: Request,
  endpoint: EndpointType,
  env: RateLimitEnvLike,
  kv: KVLike
): Promise<RateLimitResult> {
  const config = getRateLimitConfig(env);

  if (!config.enabled) {
    return { allowed: true, headers: new Headers() };
  }

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowEndMs = windowStartMs + windowMs;
  const identity = getClientIdentitySource(request);
  const identityHash = await sha256Hex(identity);
  const windowBucket = Math.floor(windowStartMs / 1000);
  const key = `rl:${endpoint}:${identityHash}:${windowBucket}`;

  const existing = (await kv.get(key, "json")) as RateLimitRecord | null;
  const currentCount = existing?.count ?? 0;
  const nextCount = currentCount + 1;
  const remaining = config.maxRequests - nextCount;
  const resetEpochSeconds = Math.ceil(windowEndMs / 1000);
  const headers = rateLimitHeaders(config.maxRequests, remaining, resetEpochSeconds);

  if (nextCount > config.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000));
    headers.set("retry-after", String(retryAfterSeconds));
    return { allowed: false, headers };
  }

  await kv.put(
    key,
    JSON.stringify({
      count: nextCount,
      windowStartMs,
    } satisfies RateLimitRecord),
    { expirationTtl: config.windowSeconds + 5 }
  );

  return { allowed: true, headers };
}
