# Entra ID OAuth Authentication — Implementation Plan

## Context

- **Tenant**: `ce6d05e1-3c5e-4d62-87a8-4c4a2713c113` (Oregon State University)
- **Signed-in az CLI user**: `sa_azr_peterdir@oregonstate.edu` (Dirk Petersen)
- **Signed-in GitHub user**: `dirkpetersen` (admin on `oregonstate-ai`)
- **Function App**: `github-identity-bridge-app.azurewebsites.net`
- **Resource Group**: `github-identity-bridge-rg` in **`UIT - peterdir sandbox`** (subscription `0973339e-9980-4e2c-b3b8-788b7927d483`)
- **`sa_azr_peterdir` role on sandbox**: **Owner** — all Azure CLI steps can be run as-is

### Current state

| Setting | Status |
|---|---|
| Entra ID app registration | **Does not exist** — needs creating |
| `USE_MOCK_OAUTH` | `true` — needs flipping to `false` after credentials are set |
| `REDIRECT_URI` | Already correct: `.../api/AuthCallback` (mixed case) |
| `GITHUB_ORG_NAME` | Already set: `oregonstate-ai` |
| `GITHUB_GATEKEEPER_TEAM_SLUG` | Already set: `active-session-users` |
| Org base permission | Already `none` — no action needed |
| Org member repo creation | Already disabled — no action needed |
| Org 2FA requirement | **Not enabled** — needs manual action |
| `Login/index.js` | Returns mock string — **not** a real redirect |
| Deployment method | Currently `WEBSITE_RUN_FROM_PACKAGE` (zip blob) — Phase 9 will switch to `func publish` |

---

# Phase 1 — Full Implementation (no admin consent required)

All steps below are fully self-serviceable by `sa_azr_peterdir` / `dirkpetersen`.
The Hard Kick feature (terminate users whose AD account is disabled) is deferred to Phase 2
and requires an OSU Global/Application Admin — see bottom of this document.

---

## Step 1 — Create the Entra ID App Registration

```bash
az account set --name "UIT - peterdir sandbox"

az ad app create \
  --display-name "github-identity-bridge" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris \
    "https://github-identity-bridge-app.azurewebsites.net/api/AuthCallback" \
    "http://localhost:7071/api/AuthCallback"
```

Save the `appId` output — this becomes `AZURE_CLIENT_ID`.

```bash
az ad app credential reset \
  --id <appId> \
  --display-name "github-identity-bridge-secret" \
  --years 2
```

Save the `password` output — this becomes `AZURE_CLIENT_SECRET`. Shown only once.

---

## Step 2 — Configure Microsoft Graph Permissions (login scopes only)

The delegated scopes `openid`, `profile`, and `email` are the only ones needed for Phase 1.
These require no admin consent — each user approves them at login time.

They are included by default in new app registrations. Verify in the portal:
**Entra ID → App registrations → github-identity-bridge → API permissions**
should show `Microsoft Graph / openid, profile, email` with status "Granted (user consent)".

No CLI commands needed here unless the defaults were removed.

---

## Step 3 — Fix the Login Function

`Login/index.js` currently returns a static string instead of redirecting to Azure AD.
The redirect helper already exists in `shared/azure-ad.js:buildAzureAdAuthUrl`.

**Change needed in `Login/index.js`:**

```js
const azureAd = require('../shared/azure-ad');
const mockOAuth = require('../shared/mock-oauth');

module.exports = async function (context, req) {
  if (mockOAuth.MOCK_MODE) {
    const mockRedirectUrl = `${process.env.REDIRECT_URI || 'http://localhost:7071/api/AuthCallback'}?code=mock-test&state=azure_init`;
    context.res = { status: 200, body: `Login working! Would redirect to: ${mockRedirectUrl}` };
    return;
  }

  const authUrl = azureAd.buildAzureAdAuthUrl('azure_init');
  context.res = {
    status: 302,
    headers: { Location: authUrl }
  };
};
```

---

## Step 4 — Fix Redirect URI Casing in `.env.default`

The deployed Function App already has `REDIRECT_URI=.../api/AuthCallback` (correct).
`.env.default` has `/api/authcallback` (lowercase) in two places — fix those so local dev
with real credentials doesn't get rejected by Entra ID.

---

## Step 5 — Set Entra ID Credentials on Function App

```bash
az account set --name "UIT - peterdir sandbox"

az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings \
    "USE_MOCK_OAUTH=false" \
    "AZURE_TENANT_ID=ce6d05e1-3c5e-4d62-87a8-4c4a2713c113" \
    "AZURE_CLIENT_ID=<appId from Step 1>" \
    "AZURE_CLIENT_SECRET=<secret from Step 1>"
```

(`REDIRECT_URI`, `GITHUB_ORG_NAME`, and `GITHUB_GATEKEEPER_TEAM_SLUG` are already correctly set.)

---

## Step 6 — GitHub OAuth App (Account Linking)

The current `gh` CLI token only has `read:org` scope — use the GitHub web UI:

1. Go to `https://github.com/settings/developers` → OAuth Apps → New OAuth App
   - **Application name**: `github-identity-bridge`
   - **Homepage URL**: `https://github-identity-bridge-app.azurewebsites.net`
   - **Authorization callback URL**: `https://github-identity-bridge-app.azurewebsites.net/api/AuthCallback`
2. Copy **Client ID** → `GITHUB_OAUTH_CLIENT_ID`
3. Generate **Client Secret** → `GITHUB_OAUTH_CLIENT_SECRET` (one-time display)

```bash
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings \
    "GITHUB_OAUTH_CLIENT_ID=<value>" \
    "GITHUB_OAUTH_CLIENT_SECRET=<value>"
```

---

## Step 7 — GitHub App (Org Bot)

`dirkpetersen` is an admin on `oregonstate-ai` — use the GitHub web UI:

1. Go to `https://github.com/organizations/oregonstate-ai/settings/apps` → New GitHub App
   - **GitHub App name**: `github-identity-bridge`
   - **Webhook URL**: `https://github-identity-bridge-app.azurewebsites.net/api/GithubWebhook`
   - **Webhook secret**: `openssl rand -hex 32` — note the value
   - **Permissions**:
     - Organization → Members: **Read & Write**
     - Organization → Team members: **Read & Write**
   - **Events**: `member`
2. Generate a **Private Key** (downloads `.pem`)
3. Install the app on `oregonstate-ai`; the installation URL ends in the **Installation ID**

```bash
PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' github-identity-bridge.private-key.pem)

az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings \
    "GITHUB_APP_ID=<app-id>" \
    "GITHUB_APP_INSTALLATION_ID=<installation-id>" \
    "GITHUB_APP_WEBHOOK_SECRET=<webhook-secret>" \
    "GITHUB_APP_PRIVATE_KEY=${PRIVATE_KEY}"
```

---

## Step 8 — GitHub Org Hardening

Org base permissions and member repo creation are already correctly configured. Remaining:

```bash
# Create the gatekeeper team if it doesn't exist yet
gh api /orgs/oregonstate-ai/teams \
  -f name='Active-Session-Users' \
  -f privacy='closed'

# Grant the team access to demo-repository
gh api /orgs/oregonstate-ai/teams/active-session-users/repos/oregonstate-ai/demo-repository \
  -X PUT -f permission=push
```

**Manual step** — must be done in the portal (API does not allow this):
Enable 2FA requirement at `https://github.com/organizations/oregonstate-ai/settings/security`.

---

## Step 9 — Deploy Updated Code

```bash
az account set --name "UIT - peterdir sandbox"
func azure functionapp publish github-identity-bridge-app
```

---

## Step 10 — End-to-End Verification

```bash
# 1. Health check
curl https://github-identity-bridge-app.azurewebsites.net/api/HealthCheck | jq

# 2. Confirm /Login returns a 302 to login.microsoftonline.com
curl -I https://github-identity-bridge-app.azurewebsites.net/api/Login
# Expect: HTTP 302, Location: https://login.microsoftonline.com/ce6d05e1.../oauth2/v2.0/authorize?...

# 3. Full browser flow: visit /api/Login, sign in with OSU credentials + Duo,
#    authorise GitHub OAuth, confirm success page.

# 4. Verify user added to org and gatekeeper team
gh api /orgs/oregonstate-ai/teams/active-session-users/members | jq '.[].login'

# 5. Verify audit log written to Table Storage
az storage entity query \
  --connection-string "$(az functionapp config appsettings list \
    --name github-identity-bridge-app \
    --resource-group github-identity-bridge-rg \
    --query "[?name=='AzureWebJobsStorage'].value" -o tsv)" \
  --table-name AuditLogs \
  --output table
```

---

# Project B — Hard Kick (Terminated Employee Auto-Removal)

**Prerequisite**: An OSU **Application Administrator** or **Global Administrator** must grant
admin consent for the `User.Read.All` Graph permission (one-time portal action).

**What this enables**: The Audit function (runs every 15 min) will call the Microsoft Graph API
to check whether each user's AD account is still `accountEnabled`. If an employee is terminated
or suspended in AD, they are immediately removed from the GitHub org entirely — rather than
waiting up to 24 hours for their session lease to expire.

**Without this project**: terminated employees retain GitHub access for up to 24 hours (until
their Soft Lock kicks in). That is acceptable for a pilot but should be closed before wider rollout.

## Step 1 — Add `User.Read.All` Application Permission

```bash
USER_READ_ALL_ID=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 \
  --query "appRoles[?value=='User.Read.All'].id" -o tsv)

az ad app permission add \
  --id <appId> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions "${USER_READ_ALL_ID}=Role"
```

## Step 2 — Grant Admin Consent

This command will fail unless the caller holds Application Admin or Global Admin:

```bash
az ad app permission admin-consent --id <appId>
```

Alternatively, an admin can click **Grant admin consent for Oregon State University** in:
Entra portal → App registrations → `github-identity-bridge` → API permissions.

Verify: `User.Read.All` shows "Granted for Oregon State University".

To find who holds the Application Administrator role at OSU:

```bash
az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/directoryRoles?\$expand=members" \
  --query "value[?displayName=='Application Administrator'].members[].userPrincipalName" \
  -o tsv
```

---

## Open Questions

1. **Which repositories** should the `Active-Session-Users` team have access to in `oregonstate-ai`? Step 8 needs a concrete list.

2. **Key Vault for secrets**: `AZURE_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY` are sensitive. For production, move these into Azure Key Vault and reference them via Key Vault references in Function App settings.

3. **`dirkpetersen` GitHub token scopes**: Current token has `read:org`, not `admin:org`. GitHub App and OAuth App creation must go through the web UI. To enable CLI, re-authenticate: `gh auth login` and add the `admin:org` scope.

4. **Sandbox vs. production**: This plan targets `UIT - peterdir sandbox`. When moving to production (`UIT - Infrastructure`), Contributor/Owner on that subscription's resource group is required for the `az functionapp config appsettings set` commands.
