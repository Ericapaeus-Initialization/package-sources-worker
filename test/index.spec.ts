import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("package proxy worker", () => {
	it("returns usage instructions on the root route", async () => {
		const request = new IncomingRequest("https://packages.example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			endpoints: {
				npm: "https://packages.example.com/npm/",
				pipSimple: "https://packages.example.com/pip/simple",
			},
		});
	});

	it("rewrites npm metadata tarball urls back through the worker", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						name: "left-pad",
						versions: {
							"1.3.0": {
								dist: {
									tarball: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
								},
							},
						},
					}),
					{ headers: { "content-type": "application/json" } },
				),
			),
		);

		const request = new IncomingRequest("https://packages.example.com/npm/left-pad");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			versions: {
				"1.3.0": {
					dist: {
						tarball: "https://packages.example.com/npm/left-pad/-/left-pad-1.3.0.tgz",
					},
				},
			},
		});
	});

	it("rewrites pip simple index download links through the worker", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					'<html><body><a href="https://files.pythonhosted.org/packages/pkg/demo-1.0.0.tar.gz">demo</a></body></html>',
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				),
			),
		);

		const request = new IncomingRequest("https://packages.example.com/pip/simple/demo/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain(
			"https://packages.example.com/pip/packages/pkg/demo-1.0.0.tar.gz",
		);
	});

	it("rewrites root-relative pip simple index links (modern PyPI format)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					'<html><body><a href="/packages/ab/cd/requests-2.28.1.tar.gz#sha256=abc">requests</a></body></html>',
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				),
			),
		);

		const request = new IncomingRequest("https://packages.example.com/pip/simple/requests/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const body = await response.text();
		expect(body).toContain('href="https://packages.example.com/pip/packages/ab/cd/requests-2.28.1.tar.gz#sha256=abc"');
	});

	it("routes /npm without trailing slash (npm ping uses bare /npm path)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
			),
		);

		const request = new IncomingRequest("https://packages.example.com/npm");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// /npm without trailing slash should be proxied, not return 404
		expect(response.status).toBe(200);
	});

	it("follows upstream redirects instead of returning 302 to client (internal isolation)", async () => {
		// With redirect:"follow", fetch() transparently follows the upstream 302 → CDN
		// and returns the final 200. The client should never see a 3xx.
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("wheel-binary-data", {
					status: 200,
					headers: { "content-type": "application/zip" },
				}),
			),
		);

		const request = new IncomingRequest(
			"https://packages.example.com/pip/packages/ab/cd/requests-2.28.1-py3-none-any.whl",
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
	});

	it("sets immutable Cache-Control on versioned package files", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("binary", { status: 200, headers: { "content-type": "application/zip" } }),
			),
		);

		const request = new IncomingRequest(
			"https://packages.example.com/pip/packages/ab/cd/requests-2.28.1-py3-none-any.whl",
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
	});

	it("sets short Cache-Control on metadata responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					'<html><body><a href="/packages/ab/cd/demo-1.0.tar.gz">demo</a></body></html>',
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				),
			),
		);

		const request = new IncomingRequest("https://packages.example.com/pip/simple/demo/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get("cache-control")).toBe("public, max-age=60");
	});

	it("serves the worker entrypoint in integration mode", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			service: "Cloudflare Worker proxy for npm and pip registries",
		});
	});
});
