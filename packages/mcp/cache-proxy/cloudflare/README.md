# Context7 MCP Cache Proxy (Cloudflare)

This worker is a cache layer in front of Context7 API for MCP traffic.

It keeps the same Context7 API behavior. The only difference is that requests pass through your worker first to check cache.

It uses two cache layers:

1. Cloudflare Cache API (`caches.open`) for fast edge responses
2. Cloudflare KV (`CONTEXT7_KV`) as cross-region fallback

It also applies request rate limiting (configurable via env vars).

The key is derived from endpoint + normalized query params + a hash of `Authorization`.

## Supported endpoints

- `/v2/libs/search`
- `/v2/context`

## Cache key parameters

The cache key includes endpoint + normalized query params + hashed `Authorization`.

- `GET /v2/libs/search`
  - `query`
  - `libraryName`
- `GET /v2/context`
  - `query`
  - `libraryId`
  - `type` (`txt` or `json`)

## Setup

1. Copy `wrangler.sample.json` to `wrangler.json`
2. Copy `.env.example` to `.env` and update values
3. Edit `wrangler.json` with your Cloudflare KV namespace IDs and worker name/url
4. Set proxy auth key as secret (recommended):

```bash
pnpm wrangler secret put CONTEXT7_PROXY_KEY
```

`PROXY_KEY` is also supported.

## Rate limiting

Rate limiting is enabled by default and can be configured via env vars:

- `RATE_LIMIT_ENABLED` (default: `true`)
- `RATE_LIMIT_MAX_REQUESTS` (default: `120`)
- `RATE_LIMIT_WINDOW_SECONDS` (default: `60`)

The limiter uses KV (best effort, fixed window). Identity is derived from `Authorization` when present, otherwise IP headers.

Upstream is intentionally fixed to Context7 API (`https://context7.com/api`) and is not user-overridable.

## Deploy

```bash
pnpm install --ignore-workspace
pnpm deploy
```

After deploy, use your worker URL as `CONTEXT7_PROXY_URL` in MCP.

## Scripts

```bash
pnpm dev
pnpm deploy
pnpm tail
pnpm kv:list
pnpm kv:get -- --key "<kv-key>"
pnpm kv:delete -- --key "<kv-key>"
pnpm test
pnpm typecheck
pnpm lint
```

## MCP usage with this worker

```bash
npx -y @upstash/context7-mcp \
  --api-key "$CONTEXT7_API_KEY" \
  --proxy-provider cloudflare \
  --proxy-url "$CONTEXT7_PROXY_URL" \
  --proxy-key "$PROXY_KEY"
```

If your client supports environment variables directly, you can skip the proxy flags and set:

- `CONTEXT7_PROXY_PROVIDER=cloudflare`
- `CONTEXT7_PROXY_URL=...`
- `PROXY_KEY=...`

## Cache bypass

- Header: `X-Context7-Cache-Bypass: true`
- Query param: `?cache=0`

## Files you will usually edit in a fork

- `packages/mcp/cache-proxy/cloudflare/wrangler.sample.json` (copy to `wrangler.json`)
- `packages/mcp/cache-proxy/cloudflare/.env.example` (copy to `.env`)
- `packages/mcp/cache-proxy/cloudflare/src/index.ts` (worker behavior)
- `packages/mcp/cache-proxy/cloudflare/src/cache-provider.ts` (cache abstraction/provider)
