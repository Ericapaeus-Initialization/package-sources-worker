# package-sources-worker

Cloudflare Worker for proxying `npm` and `pip` package traffic through a single Worker endpoint.

## Endpoints

- `https://<your-worker>/npm/` proxies the npm registry and rewrites tarball URLs so package downloads stay on your Worker domain.
- `https://<your-worker>/pip/simple` proxies the PyPI simple index and rewrites package file links through the Worker.
- `https://<your-worker>/pip/pypi/<package>/json` proxies the PyPI JSON API.

## Local development

```bash
npm install
npm run dev
```

The local Worker runs at `http://localhost:8787`.

## Client configuration

```bash
npm config set registry https://<your-worker-domain>/npm/
pip config set global.index-url https://<your-worker-domain>/pip/simple
```

## Deploy to Cloudflare

```bash
npm run deploy
```

This project uses the latest local Worker SDK created by C3 and Wrangler.

## Enable automatic deploys on Cloudflare

Cloudflare now recommends Workers Builds for repository-driven deploys.

1. Push this project to GitHub or GitLab.
2. In Cloudflare Dashboard, open Workers & Pages.
3. Create a new application from `Import a repository`, or open an existing Worker and use `Settings` -> `Builds` -> `Connect`.
4. Make sure the Worker name in Cloudflare matches the `name` field in `wrangler.jsonc`.
5. Use the default deploy command `npm run deploy`.

After that, every push can trigger Cloudflare-side build and deployment.