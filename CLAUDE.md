# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GitHub Identity Bridge & Governance System** - Serverless Azure Functions app that bridges enterprise Azure AD authentication with GitHub organization access. Acts as a "ticket vending machine": users authenticate via corporate Azure AD (with Duo 2FA), their GitHub account gets linked, and they receive time-limited (24-hour) access to GitHub org repositories.

**Security model**: Org base permissions = "None". Only the `Active-Session-Users` team has repo access. All access flows through this single gatekeeper team.

## Configuration Files — Hard Rules

- **`.env.default`** is committed to git and must contain **only placeholder values** — never real tenant IDs, IPs, secrets, account names, org names, or any environment-specific value
- **`.env`** is gitignored and is the only place real values live — it is created by copying `.env.default` and filling in actual values
- Never write a real value into `.env.default` for any reason, even temporarily

## Development Commands

```bash
# Local development (uses local-server.js via Express, no Azure Functions Core Tools needed)
npm start

# Local development with Azure Functions Core Tools
npm run start:func   # requires `func` CLI installed

# Run tests
npm test             # Jest with coverage
npm run test:watch   # watch mode

# Run a single test file
npm test -- tests/auth-callback.test.js

# Lint
npm run lint

# Deploy to Azure — MUST use --build remote
npx azure-functions-core-tools@4 azure functionapp publish github-identity-bridge-app --build remote
```

**`func` CLI**: not installed globally — use `npx azure-functions-core-tools@4` for all `func` commands.

**`--build remote` is mandatory**: without it Azure deploys the code without running `npm install`, causing every function that imports a package to fail with `Cannot find module`. Always use `--build remote`.

**Local config**: Copy `.env.default` to `.env`, fill in values, then run `./scripts/generate-local-settings.sh` to produce `local.settings.json`. The default config has `USE_MOCK_OAUTH=true` which bypasses real Azure AD and GitHub credentials.

## Code Architecture

### Folder Structure

Functions live at the **root level** (not in a `functions/` subfolder — this is required by Azure Functions):

```
Login/              # Initiates Azure AD OAuth flow — 302 redirect to Entra ID
AuthCallback/       # Handles OAuth callbacks (both Azure AD and GitHub stages)
Audit/              # Timer trigger (every 15 min): enforces lease expiration + offboarding
HealthCheck/        # System health status
SanityCheck/        # Zero-dependency smoke test (no shared module imports)
Diagnostic/         # Dumps environment variable names — useful for deployment debugging
GithubWebhook/      # Receives GitHub org webhook events
shared/             # Shared modules (imported as '../shared/X' from function dirs)
scripts/            # Deployment and setup scripts
docs/               # Extended documentation
```

Each function folder contains `function.json` (trigger/binding config) and `index.js` (handler). All output bindings must use `"name": "res"` (not `"$return"`) since handlers use `context.res = {...}`.

### Shared Modules

- `shared/database.js` - Azure Table Storage: `UserMappings` table (`PartitionKey=OrgName`, `RowKey=corpEmail`) and `AuditLogs` table
- `shared/github.js` - Octokit wrappers: `addUserToOrg`, `addUserToTeam`, `removeUserFromTeam`, `removeUserFromOrg`, `validateWebhookSignature`
- `shared/azure-ad.js` - Azure AD OAuth helpers + Microsoft Graph API calls to check `accountEnabled`
- `shared/mock-oauth.js` - Mock implementations for all OAuth operations; enabled via `USE_MOCK_OAUTH=true`
- `shared/logger.js` - Logging wrapper with Application Insights integration

### OAuth Flow (AuthCallback state machine)

`AuthCallback/index.js` handles two stages via the `state` query param:
1. `state=azure_init` — returning from Azure AD; extract email from ID token, check DB for existing user. If new: redirect to GitHub OAuth (`state=github_init|{email}`). If returning: update `LastLoginTimestamp`, re-add to team.
2. `state=github_init|{email}` — returning from GitHub OAuth; exchange code for token, get GitHub username, store mapping in DB, add to org + gatekeeper team.

### Audit Logic (Audit/index.js)

Runs every 15 minutes. For each user in DB:
- **Hard Kick**: AD `accountEnabled=false` → remove from org entirely + delete DB record (requires Project B — `User.Read.All` admin consent)
- **Soft Lock**: lease expired (>24h since `LastLoginTimestamp`) → remove from gatekeeper team only (preserves org membership)
- **Active**: valid lease → self-healing add to team (ensures consistency)

In mock mode (`USE_MOCK_OAUTH=true`), users with "disabled" in their email are treated as terminated.

## Deployed Environment

- **Subscription**: `UIT - peterdir sandbox` (`0973339e-9980-4e2c-b3b8-788b7927d483`)
- **Function App**: `github-identity-bridge-app.azurewebsites.net`
- **Resource Group**: `github-identity-bridge-rg` (West US 2)
- **Storage Account**: `ghidbridgeelvtn5wpwujr2`
- **Entra ID Tenant**: `ce6d05e1-3c5e-4d62-87a8-4c4a2713c113` (Oregon State University)
- **Entra ID App**: `github-identity-bridge` (`c3c5534d-a8bf-46a5-b914-ab413e532275`)
- **GitHub Org**: `oregonstate-ai`
- **Gatekeeper Team**: `active-session-users` (has access to `demo-repository`)
- **Runtime**: Linux, Node 20 (Node 24 tested March 2026 — causes 503 on Consumption plan, not yet supported), Functions v4, extension bundle v4
- **Mode**: `USE_MOCK_OAUTH=false` (live Entra ID + GitHub OAuth)

To switch subscription before any `az` commands:
```bash
az account set --name "UIT - peterdir sandbox"
```

## Critical Azure Functions Rules

These are hard-won lessons from deployment — violating them causes silent failures:

1. **`--build remote` on every deploy** — omitting it skips `npm install` on Azure; all functions importing packages silently fail with `Cannot find module` and return HTTP 500 with empty body.
2. **No `"main"` in package.json** — Azure tries to run it as the entry point, crashing the runtime. Functions are discovered from `function.json` files.
3. **Output binding must be `"name": "res"`** — Using `"$return"` when code sets `context.res` causes HTTP 204 (empty responses).
4. **Functions at root level** — placing them in a `functions/` subfolder causes "Functions detected: 0".
5. **Node 20 LTS only** — Node 18 (EOL) and Node 24 (unsupported) both cause "Syncing triggers (BadRequest)".
6. **Extension bundle v4** — `host.json` must specify `[4.*, 5.0.0)` for Functions runtime v4.
7. **Redirect URI casing** — Entra ID validates redirect URIs case-sensitively. The registered URI and `REDIRECT_URI` env var must both use `/api/AuthCallback` (mixed case). Lowercase `/api/authcallback` will cause OAuth failures.
8. **Node 24 not yet supported on Linux Consumption** — Despite Azure CLI warnings to upgrade, setting `linuxFxVersion=Node|24` causes persistent HTTP 503. Confirmed tested March 2026. Stay on Node 20 until Azure confirms Consumption plan support. Revert with: `az functionapp config set --linux-fx-version "Node|20"`

## Diagnosing Deployment Issues

When a function returns unexpected HTTP status codes after deploy:

| Symptom | Likely cause |
|---|---|
| HTTP 404 on a function that was listed at deploy time | Cold start — wait 10s and retry |
| HTTP 500 with empty body | Module failed to load (missing `node_modules` — redeploy with `--build remote`) |
| HTTP 500 with error message | Runtime exception — check the error text |
| HTTP 204 | Output binding named `"$return"` instead of `"res"` |
| "Functions detected: 0" | Functions not at root level, or `"main"` in package.json |

Use `SanityCheck` and `Diagnostic` as baseline — they have no shared module dependencies and will work even when other functions fail due to missing packages.

```bash
# Baseline check
curl https://github-identity-bridge-app.azurewebsites.net/api/sanitycheck
curl https://github-identity-bridge-app.azurewebsites.net/api/diagnostic | jq .

# Confirm Login redirects correctly
curl -sI https://github-identity-bridge-app.azurewebsites.net/api/login | grep -E "HTTP|location"
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `USE_MOCK_OAUTH` | `true` bypasses real Azure AD/GitHub OAuth |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Entra ID app registration |
| `REDIRECT_URI` | OAuth callback URL — must match Entra ID registration exactly (case-sensitive) |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app (account linking) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID` | GitHub App (bot operations via Octokit) |
| `GITHUB_APP_WEBHOOK_SECRET` | HMAC-SHA256 webhook validation |
| `GITHUB_ORG_NAME` | Target GitHub organization |
| `GITHUB_GATEKEEPER_TEAM_SLUG` | Team slug (default: `active-session-users`) |
| `AzureWebJobsStorage` | Azure Table Storage connection string (auto-set by Azure) |
