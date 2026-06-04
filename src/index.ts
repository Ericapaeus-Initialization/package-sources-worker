const NPM_ORIGIN = "https://registry.npmjs.org";
const PYPI_ORIGIN = "https://pypi.org";
const PYPI_FILES_ORIGIN = "https://files.pythonhosted.org";

const IMMUTABLE_TTL = 31536000; // 1 year – versioned package files never change
const METADATA_TTL = 60; // 60 s   – metadata may change when new versions are published

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export default {
	async fetch(request, _env, ctx): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(),
			});
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			return json(
				{
					error: "method_not_allowed",
					message: "Only GET, HEAD, and OPTIONS are supported.",
				},
				405,
			);
		}

		const url = new URL(request.url);
		const ttl = cacheTtl(url.pathname);

		// Serve from edge cache when available (Cache API supports GET only)
		if (request.method === "GET") {
			const cached = await caches.default.match(request);
			if (cached) return cached;
		}

		let response: Response;

		if (url.pathname === "/") {
			response = json({
				name: "package-sources-worker",
				service: "Cloudflare Worker proxy for npm and pip registries",
				endpoints: {
					npm: `${url.origin}/npm/`,
					pipSimple: `${url.origin}/pip/simple`,
					pipJson: `${url.origin}/pip/pypi/<package>/json`,
				},
				usage: {
					npm: `npm config set registry ${url.origin}/npm/`,
					pip: `pip config set global.index-url ${url.origin}/pip/simple`,
				},
			});
		} else if (url.pathname === "/npm" || url.pathname.startsWith("/npm/")) {
			response = await proxyNpm(request, url, ttl);
		} else if (url.pathname === "/pip" || url.pathname.startsWith("/pip/")) {
			response = await proxyPip(request, url, ttl);
		} else {
			response = json(
				{
					error: "not_found",
					message: "Use /npm/* or /pip/*.",
				},
				404,
			);
		}

		// Populate edge cache for successful GET responses
		if (request.method === "GET" && response.status === 200) {
			ctx.waitUntil(caches.default.put(request, response.clone()));
		}

		return response;
	},
} satisfies ExportedHandler<Env>;

async function proxyNpm(request: Request, url: URL, ttl: number): Promise<Response> {
	const upstreamUrl = new URL(url.pathname.replace(/^\/npm/, "") + url.search, NPM_ORIGIN);
	const upstreamResponse = await fetchUpstream(request, upstreamUrl);
	const contentType = upstreamResponse.headers.get("content-type") || "";

	if (!contentType.includes("application/json")) {
		return buildProxyResponse(upstreamResponse, ttl);
	}

	const payload = (await upstreamResponse.json()) as JsonValue;
	const rewritten = rewriteJsonStrings(payload, (value) => rewriteRegistryUrl(value, url.origin));

	return jsonResponse(rewritten, upstreamResponse.status, upstreamResponse.headers, url.origin, ttl);
}

async function proxyPip(request: Request, url: URL, ttl: number): Promise<Response> {
	const pipPath = url.pathname.replace(/^\/pip/, "") || "/";
	const upstreamUrl = resolvePipUpstreamUrl(pipPath, url.search);

	if (!upstreamUrl) {
		return json(
			{
				error: "not_found",
				message: "Use /pip/simple/*, /pip/pypi/*, or /pip/packages/*.",
			},
			404,
		);
	}

	const upstreamResponse = await fetchUpstream(request, upstreamUrl);
	const contentType = upstreamResponse.headers.get("content-type") || "";

	if (contentType.includes("text/html")) {
		const html = await upstreamResponse.text();
		const rewritten = rewriteTextUrls(html, url.origin);
		return textResponse(rewritten, upstreamResponse.status, upstreamResponse.headers, url.origin, contentType, ttl);
	}

	if (contentType.includes("application/json")) {
		const payload = (await upstreamResponse.json()) as JsonValue;
		const rewritten = rewriteJsonStrings(payload, (value) => rewritePipUrl(value, url.origin));
		return jsonResponse(rewritten, upstreamResponse.status, upstreamResponse.headers, url.origin, ttl);
	}

	return buildProxyResponse(upstreamResponse, ttl);
}

function resolvePipUpstreamUrl(pipPath: string, search: string): URL | null {
	if (pipPath === "/" || pipPath === "") {
		return new URL("/simple/", PYPI_ORIGIN);
	}

	if (pipPath.startsWith("/simple")) {
		return new URL(`${pipPath}${search}`, PYPI_ORIGIN);
	}

	if (pipPath.startsWith("/pypi")) {
		return new URL(`${pipPath}${search}`, PYPI_ORIGIN);
	}

	if (pipPath.startsWith("/packages")) {
		return new URL(`${pipPath}${search}`, PYPI_FILES_ORIGIN);
	}

	return null;
}

function rewriteJsonStrings(value: JsonValue, rewrite: (input: string) => string): JsonValue {
	if (typeof value === "string") {
		return rewrite(value);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => rewriteJsonStrings(entry, rewrite));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, rewriteJsonStrings(entry, rewrite)]),
		) as JsonValue;
	}

	return value;
}

function rewriteRegistryUrl(value: string, origin: string): string {
	return value.replace(/^https:\/\/registry\.npmjs\.(org|com)\//, `${origin}/npm/`);
}

function rewritePipUrl(value: string, origin: string): string {
	if (value.startsWith(`${PYPI_FILES_ORIGIN}/packages/`)) {
		return `${origin}/pip${new URL(value).pathname}`;
	}

	if (value.startsWith(`${PYPI_ORIGIN}/simple/`) || value.startsWith(`${PYPI_ORIGIN}/pypi/`)) {
		return `${origin}/pip${new URL(value).pathname}${new URL(value).search}`;
	}

	return value;
}

function rewriteTextUrls(value: string, origin: string): string {
	return value
		// absolute URLs (some mirrors and older PyPI responses)
		.replaceAll(`${PYPI_FILES_ORIGIN}/packages/`, `${origin}/pip/packages/`)
		.replaceAll(`${PYPI_ORIGIN}/simple/`, `${origin}/pip/simple/`)
		.replaceAll(`${PYPI_ORIGIN}/pypi/`, `${origin}/pip/pypi/`)
		// root-relative paths (modern PyPI simple index uses href="/packages/...")
		.replace(/(href|src)="\/packages\//g, `$1="${origin}/pip/packages/`)
		.replace(/(href|src)='\/packages\//g, `$1='${origin}/pip/packages/`)
		.replace(/(href|src)="\/simple\//g, `$1="${origin}/pip/simple/`)
		.replace(/(href|src)='\/simple\//g, `$1='${origin}/pip/simple/`);
}

async function fetchUpstream(request: Request, upstreamUrl: URL): Promise<Response> {
	const headers = new Headers(request.headers);
	headers.delete("host");

	// redirect:"follow" ensures the Worker itself follows any CDN/redirect hops
	// so 302 responses never leak back to the client, keeping all traffic
	// inside the Worker (required for internal network isolation).
	return fetch(upstreamUrl, {
		method: request.method,
		headers,
		redirect: "follow",
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...corsHeaders(),
		},
	});
}

function jsonResponse(body: JsonValue, status: number, headers: Headers, origin: string, ttl: number): Response {
	const nextHeaders = cloneResponseHeaders(headers);
	nextHeaders.set("content-type", "application/json; charset=utf-8");
	nextHeaders.delete("content-encoding");
	nextHeaders.delete("etag");
	nextHeaders.delete("last-modified");
	nextHeaders.delete("cf-cache-status");
	applyCorsHeaders(nextHeaders);
	nextHeaders.set("x-proxy-origin", origin);
	nextHeaders.set("cache-control", cacheControlDirective(ttl));

	return new Response(JSON.stringify(body), {
		status,
		headers: nextHeaders,
	});
}

function textResponse(body: string, status: number, headers: Headers, origin: string, contentType: string, ttl: number): Response {
	const nextHeaders = cloneResponseHeaders(headers);
	nextHeaders.set("content-type", contentType || "text/html; charset=utf-8");
	nextHeaders.delete("content-encoding");
	nextHeaders.delete("etag");
	nextHeaders.delete("last-modified");
	nextHeaders.delete("cf-cache-status");
	applyCorsHeaders(nextHeaders);
	nextHeaders.set("x-proxy-origin", origin);
	nextHeaders.set("cache-control", cacheControlDirective(ttl));

	return new Response(body, {
		status,
		headers: nextHeaders,
	});
}

function buildProxyResponse(upstreamResponse: Response, ttl: number): Response {
	const headers = new Headers(upstreamResponse.headers);
	headers.set("cache-control", cacheControlDirective(ttl));
	return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		headers,
	});
}

function cloneResponseHeaders(headers: Headers): Headers {
	const nextHeaders = new Headers(headers);
	nextHeaders.delete("content-length");
	return nextHeaders;
}

function cacheTtl(pathname: string): number {
	if (pathname.startsWith("/pip/packages/")) return IMMUTABLE_TTL;
	if (/\/npm\/.+\/-\/.+\.tgz$/.test(pathname)) return IMMUTABLE_TTL;
	return METADATA_TTL;
}

function cacheControlDirective(ttl: number): string {
	return ttl >= IMMUTABLE_TTL ? `public, max-age=${ttl}, immutable` : `public, max-age=${ttl}`;
}

const CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET,HEAD,OPTIONS",
	"access-control-allow-headers": "*",
};

function corsHeaders(): Record<string, string> {
	return CORS_HEADERS;
}

function applyCorsHeaders(headers: Headers): void {
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		headers.set(key, value);
	}
}
