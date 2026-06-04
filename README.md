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

Replace `<your-worker-domain>` with your deployed Worker URL (e.g. `package-sources-worker.example.workers.dev`).

### npm

**Global (persistent):**
```bash
npm config set registry https://<your-worker-domain>/npm/
```

**Per-command:**
```bash
npm install --registry https://<your-worker-domain>/npm/
```

**Per-project (`.npmrc`):**
```
registry=https://<your-worker-domain>/npm/
```

### pip

**Global (persistent):**
```bash
pip config set global.index-url https://<your-worker-domain>/pip/simple/
```

**Per-command:**
```bash
pip install --index-url https://<your-worker-domain>/pip/simple/ <package>
```

**Per-project (`pip.ini` / `pyproject.toml` via `uv`):**
```ini
[global]
index-url = https://<your-worker-domain>/pip/simple/
```

## Deploy to Cloudflare

Deployment is handled automatically by **Cloudflare Workers Builds** on every push to `main`.

For local/manual deployment:

```bash
npm run deploy
```

## GitHub Actions (CI)

Every push and pull request runs the test suite automatically. See [.github/workflows/deploy.yml](.github/workflows/deploy.yml).