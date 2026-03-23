# Troubleshooting Guide

## Quick Diagnostic Commands

Run these first to establish a baseline before investigating further.

```bash
# Is the function app up?
curl https://github-identity-bridge-app.azurewebsites.net/api/sanitycheck

# Are environment variables set correctly?
curl https://github-identity-bridge-app.azurewebsites.net/api/diagnostic | jq .

# Is the login redirect working?
curl -sI https://github-identity-bridge-app.azurewebsites.net/api/login | grep -E "HTTP|location"

# Is the health check OK?
curl https://github-identity-bridge-app.azurewebsites.net/api/healthcheck | jq .
```

---

## Deployment Problems

### "Cannot find module" — HTTP 500 with empty body after deploy

**Cause**: The deployment ran without `--build remote`, so Azure never executed `npm install`. The code was uploaded but `node_modules` is absent.

**Fix**: Always deploy with `--build remote`:
```bash
npx azure-functions-core-tools@4 azure functionapp publish github-identity-bridge-app --build remote
```

**How to confirm this is the problem**: `SanityCheck` and `Diagnostic` will return 200 (they have no npm dependencies), but any function that imports from `shared/` or uses `axios`/`octokit` etc. will return 500 with empty body.

---

### HTTP 404 on Login when other functions respond fine

**Most likely cause**: Testing with `curl -I` or `curl --head`, which sends a HEAD request. Login's `function.json` only accepts `["get", "post"]` — HEAD is rejected with 404.

**Fix**: Always test Login with an explicit GET:
```bash
curl -s -o /dev/null -w "%{http_code}" -X GET https://github-identity-bridge-app.azurewebsites.net/api/login
# Expected: 302
```

---

### HTTP 404 on a function immediately after deploy

**Cause**: Cold start. The Functions host is still loading the worker process.

**Fix**: Wait 10–15 seconds and retry. If it persists beyond 30 seconds, it is a genuine 404 (function not registered — see below).

**After a Node runtime version change**: Functions that import shared modules (Login, AuthCallback, Audit etc.) can take 2–3 minutes to come back up after a `linuxFxVersion` change, even after `SanityCheck` returns 200. This is normal — the host re-initialises each worker lazily. Wait up to 3 minutes before concluding there is a problem.

---

### "Functions detected: 0" at deploy time

**Causes and fixes**:
- Functions are not at the root level — each function folder (`Login/`, `AuthCallback/`, etc.) must be a direct child of the project root, not inside a `functions/` subfolder
- `"main"` field exists in `package.json` — remove it entirely; Azure discovers functions from `function.json` files, not a main entry point

---

### HTTP 204 (empty response) from an HTTP function

**Cause**: The `function.json` output binding is named `"$return"` but the handler sets `context.res`. They must match.

**Fix**: Ensure every function's `function.json` has:
```json
{ "type": "http", "direction": "out", "name": "res" }
```

---

### "Syncing triggers (BadRequest)" at deploy time

**Cause**: Wrong Node.js version. Azure Functions v4 requires Node 20 LTS.
- Node 18 — reached EOL, no longer supported
- Node 24 — not yet supported

**Fix**: Verify the Function App is set to Node 20:
```bash
az functionapp config show \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --query "linuxFxVersion"
```
Should return `"Node|20"`.

---

### Node 24 causes persistent HTTP 503

**Symptom**: After running `az functionapp config set --linux-fx-version "Node|24"`, the app returns 503 on all endpoints and never recovers, even after restarts and redeployment.

**Cause**: As of March 2026, Node 24 is not yet supported on Azure Functions Linux Consumption plans, despite the Azure CLI actively warning to upgrade from Node 20. The warning is premature.

**Fix**: Revert to Node 20 immediately:
```bash
az functionapp config set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --linux-fx-version "Node|20"
# Wait ~60s then verify
curl https://github-identity-bridge-app.azurewebsites.net/api/sanitycheck
```

**When to retry Node 24**: Check the [Azure Functions supported languages](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions) page for Linux Consumption plan support before attempting again.

---

### `WEBSITE_RUN_FROM_PACKAGE` / `WEBSITE_CONTENTSHARE` conflicts

When switching from zip-deploy to `--build remote`, the func CLI automatically removes `WEBSITE_RUN_FROM_PACKAGE`, `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`, and `WEBSITE_CONTENTSHARE`. This is expected and correct — you will see these lines in the deploy output:
```
Removing WEBSITE_RUN_FROM_PACKAGE app setting.
Removing WEBSITE_CONTENTAZUREFILECONNECTIONSTRING app setting.
Removing WEBSITE_CONTENTSHARE app setting.
```
Do not re-add them manually.

---

## Authentication Problems

### Login returns 302 but redirects to wrong URL / Entra ID shows error

**Cause**: `REDIRECT_URI` in the Function App settings does not exactly match the URI registered in the Entra ID app registration.

Entra ID validates redirect URIs **case-sensitively**. The correct value is:
```
https://github-identity-bridge-app.azurewebsites.net/api/AuthCallback
```
Note the mixed case `AuthCallback`. Lowercase `authcallback` will be rejected.

**Check the registered URIs**:
```bash
az ad app show --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --query "web.redirectUris" -o json
```

**Check what's set on the Function App**:
```bash
az functionapp config appsettings list \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --query "[?name=='REDIRECT_URI'].value" -o tsv
```

---

### Entra ID login succeeds but AuthCallback returns 500

**Likely causes**:
1. `AZURE_CLIENT_SECRET` is wrong or expired — check the Entra portal: App registrations → `github-identity-bridge` → Certificates & secrets. Secrets expire; generate a new one and update the Function App setting.
2. Database unavailable — `AzureWebJobsStorage` connection string is invalid or the storage account is down.

**Check the client secret expiry**:
```bash
az ad app credential list --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --query "[].{name:displayName, expires:endDateTime}" -o table
```

---

### GitHub OAuth step fails — "bad_verification_code"

**Cause**: The GitHub OAuth authorization code has already been used or has expired (codes are single-use and expire in 10 minutes). This usually means the user hit the callback URL twice, or there was a browser redirect loop.

**Fix**: Start the flow again from `/api/Login`.

---

### GitHub OAuth step fails — "redirect_uri_mismatch"

**Cause**: The `REDIRECT_URI` set in the Function App does not match the Authorization callback URL registered in the GitHub OAuth App.

**Check**: Go to https://github.com/settings/developers → OAuth Apps → `github-identity-bridge` and verify the callback URL matches `REDIRECT_URI` exactly.

---

### User authenticated but was not added to the GitHub org or team

**Causes**:
1. GitHub App is not installed on `oregonstate-ai` — go to https://github.com/organizations/oregonstate-ai/settings/installations and verify `github-identity-bridge` is listed.
2. GitHub App lacks `Members: Read & Write` or `Team members: Read & Write` permissions.
3. `GITHUB_APP_PRIVATE_KEY` is malformed — the key must be on a single line with `\n` separators when set via `az functionapp config appsettings set`.

**Verify the GitHub App installation**:
```bash
gh api /orgs/oregonstate-ai/installations --jq '.[].app_slug'
```

**Check org members**:
```bash
gh api /orgs/oregonstate-ai/members --jq '.[].login'
```

**Check team members**:
```bash
gh api /orgs/oregonstate-ai/teams/active-session-users/members --jq '.[].login'
```

---

## Audit Function Problems

### Soft Lock not triggering — users keep access after 24 hours

**Check 1**: Verify the Audit timer is running. The timer trigger runs every 15 minutes on a CRON schedule. In local development, timer triggers do not fire automatically — only HTTP triggers work with `npm start`.

**Check 2**: Look at the `LastLoginTimestamp` in the database:
```bash
az storage entity query \
  --connection-string "<AzureWebJobsStorage value>" \
  --table-name UserMappings \
  --output table
```

**Check 3**: The timestamp used for lease calculation is `user.Timestamp || user.LastLoginTimestamp` (see `Audit/index.js:68`). Azure Table Storage sets `Timestamp` automatically on every write — if a record was recently touched by anything (including the self-healing active path), the lease clock resets.

---

### Hard Kick not triggering — terminated users keep access

**Cause**: Project B (Hard Kick) requires the `User.Read.All` Microsoft Graph application permission with admin consent granted by an OSU Application Administrator or Global Administrator. Without it, `checkUserActiveInAd` will fail with 403 Forbidden and the Hard Kick logic is never reached.

Users will still be Soft Locked after 24 hours by the lease expiry. Hard Kick (immediate removal on AD disable) is a separate enhancement — see `IAM.md` Project B.

---

### Audit function error: "Database not initialized"

**Cause**: `AzureWebJobsStorage` is not set or is set to `UseDevelopmentStorage=true` in production. The Audit function calls `database.initializeDatabase()` which requires a real Azure Storage connection string.

---

## Database Problems

### Cannot query Table Storage from CLI

```bash
# Get the connection string from Function App settings
CONN=$(az functionapp config appsettings list \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --query "[?name=='AzureWebJobsStorage'].value" -o tsv)

# Query UserMappings
az storage entity query \
  --connection-string "$CONN" \
  --table-name UserMappings \
  --output table

# Query AuditLogs
az storage entity query \
  --connection-string "$CONN" \
  --table-name AuditLogs \
  --output table
```

---

### UserMappings table shows no records after a successful login

In mock mode (`USE_MOCK_OAUTH=true`), the `AuthCallback` function skips writing to the database by design. Set `USE_MOCK_OAUTH=false` and use real credentials to get database writes.

---

## Checking Live Logs

Azure Functions logs are written to Application Insights. The simplest way to see recent errors:

```bash
# Stream live logs (Ctrl+C to stop)
az webapp log tail \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg
```

In Application Insights (Azure portal):
- Navigate to the Application Insights resource linked to the Function App
- Use **Logs** → query: `traces | where timestamp > ago(1h) | order by timestamp desc`
- Or **Failures** for exceptions

---

## Checking and Updating Function App Settings

```bash
az account set --name "UIT - peterdir sandbox"

# List all settings (values shown)
az functionapp config appsettings list \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --output table

# Update a single setting
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings "USE_MOCK_OAUTH=false"

# Update the private key (must be single line)
PRIVATE_KEY=$(awk '{printf "%s\\n", $0}' github-identity-bridge.private-key.pem)
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings "GITHUB_APP_PRIVATE_KEY=${PRIVATE_KEY}"
```

---

## Entra ID App Registration

```bash
# View current app registration
az ad app show --id c3c5534d-a8bf-46a5-b914-ab413e532275 | jq .

# View registered redirect URIs
az ad app show --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --query "web.redirectUris" -o json

# Add a new redirect URI (e.g. for a new environment)
az ad app update --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --web-redirect-uris \
    "https://github-identity-bridge-app.azurewebsites.net/api/AuthCallback" \
    "http://localhost:7071/api/AuthCallback" \
    "https://new-environment.azurewebsites.net/api/AuthCallback"

# Check client secret expiry
az ad app credential list --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --query "[].{name:displayName, expires:endDateTime}" -o table

# Rotate client secret (save the new password immediately — shown only once)
az ad app credential reset \
  --id c3c5534d-a8bf-46a5-b914-ab413e532275 \
  --display-name "github-identity-bridge-secret" \
  --years 2
```

---

## End-to-End Test Checklist

```bash
# 1. Health check
curl https://github-identity-bridge-app.azurewebsites.net/api/healthcheck | jq .

# 2. Login produces a redirect to Microsoft
curl -sI https://github-identity-bridge-app.azurewebsites.net/api/login | grep location
# Expected: location: https://login.microsoftonline.com/ce6d05e1.../oauth2/v2.0/authorize?...

# 3. After completing the browser login flow, verify org membership
gh api /orgs/oregonstate-ai/members --jq '.[].login'

# 4. Verify team membership
gh api /orgs/oregonstate-ai/teams/active-session-users/members --jq '.[].login'

# 5. Verify database record written
CONN=$(az functionapp config appsettings list \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --query "[?name=='AzureWebJobsStorage'].value" -o tsv)
az storage entity query --connection-string "$CONN" --table-name UserMappings --output table

# 6. Verify audit log written
az storage entity query --connection-string "$CONN" --table-name AuditLogs --output table
```
