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

## Deploy to Cloudflare (manual)

Bump the version in `package.json`, then:

```bash
npm run deploy
```

This creates a `vX.Y.Z` git tag from the current `version` field and pushes it, which triggers the GitHub Actions workflow (test → deploy).

## Automatic deployment via GitHub Actions

Push a tag in the form `vX.Y.Z` to trigger tests followed by an automatic deploy:

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Prerequisites — two secrets needed

#### 1. `CLOUDFLARE_API_TOKEN`

Create a scoped API token at **[Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)**:

1. Click **Create Token** → **Use template** → choose **Edit Cloudflare Workers**
2. Under **Account Resources**, select your account
3. Under **Zone Resources**, select **All zones** (or restrict to the zone hosting the Worker's route if you use a custom domain)
4. Click **Continue to summary** → **Create Token**
5. Copy the token value — it won't be shown again

#### 2. `CLOUDFLARE_ACCOUNT_ID`

Found in **Cloudflare Dashboard → (select your account) → Overview**; the Account ID is displayed in the right sidebar.

### Add secrets to GitHub

In your GitHub repository go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token from step 1 above |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Once both secrets are set, push a `vX.Y.Z` tag to trigger the first deployment.