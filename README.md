# package-sources-worker

Cloudflare Worker for proxying `npm` and `pip` package traffic through a single Worker endpoint.

## Endpoints

| Path | Upstream | Notes |
|---|---|---|
| `/npm/<package>` | `registry.npmjs.org` | Full metadata JSON; tarball URLs rewritten to the Worker domain |
| `/npm/<package>/-/<file>.tgz` | `registry.npmjs.org` | Tarball download, transparently proxied |
| `/pip/simple/<package>/` | `pypi.org/simple/` | HTML simple index; absolute and root-relative download links rewritten; `#sha256=` fragments preserved |
| `/pip/pypi/<package>/json` | `pypi.org/pypi/` | PyPI JSON API; download URLs rewritten |
| `/pip/packages/*` | `files.pythonhosted.org` | Actual wheel / sdist file download |
| `/healthz` | — | Returns `ok` |

## Local development

```bash
npm install
npm run dev
```

The local Worker runs at `http://localhost:8787`.

```bash
npm test          # watch mode
npm test -- --run # single run
```

## Client configuration

```bash
npm config set registry https://<your-worker-domain>/npm/
pip config set global.index-url https://<your-worker-domain>/pip/simple/
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