# Testing Guide

## Quick Start Testing (5 minutes)

### Test with Mock OAuth (No Setup Required)

```bash
# 1. Copy config template
cp local.settings.json.example local.settings.json

# 2. Edit and ensure these settings:
# "USE_MOCK_OAUTH": "true"
# "NODE_ENV": "development"

# 3. Install dependencies
npm install

# 4. Start local functions
npm start

# 5. Open browser - you should see Azure login redirect
curl http://localhost:7071/api/Login

# 6. Verify health check
curl http://localhost:7071/api/HealthCheck | jq

# 7. Run tests
npm test
```

---

## Comprehensive Testing

### Full End-to-End Flow (with Mock OAuth)

**Step 1: Start Local Development**
```bash
npm install
npm start
# Functions now running on http://localhost:7071
```

**Step 2: Verify Health**
```bash
curl http://localhost:7071/api/HealthCheck
# Should show: database: connected, all credentials configured
```

**Step 3: Initiate Login**
```bash
curl -L http://localhost:7071/api/Login
# Should return HTML success page with mock user info
```

**Step 4: Run Unit Tests**
```bash
npm test
# Should pass all tests with mock OAuth
```

**Step 5: Verify Audit Logging**
Check Azure Table Storage (local emulator) for audit events
```bash
az storage entity query \
  --account-name <your-storage> \
  --table-name AuditLogs
```

---

## Manual Testing with Real Credentials

### Prerequisites

1. **Azure App Registration** (5 min)
   - Navigate to portal.azure.com → App registrations
   - Create app named "github-identity-bridge"
   - Copy: Application ID, Tenant ID
   - Create client secret, copy value
   - Add Redirect URI: `http://localhost:7071/api/AuthCallback`

2. **GitHub OAuth App** (5 min)
   - Go to Settings → Developer settings → OAuth Apps → New OAuth App
   - Authorization callback URL: `http://localhost:7071/api/AuthCallback`
   - Copy: Client ID, Client Secret

3. **GitHub App** (10 min)
   - See [CLAUDE.md](../CLAUDE.md) "GitHub App Setup" section
   - Copy: App ID, Installation ID, Private Key, Webhook Secret

### Local Testing with Real Credentials

```bash
# 1. Edit local.settings.json with real credentials
# Set "USE_MOCK_OAUTH": "false"
# Add AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
# Add GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
# Add GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY

# 2. Start functions
npm start

# 3. Visit Login endpoint
# Will redirect to real Azure AD login page
# After authentication, redirects to GitHub OAuth
# After GitHub authorization, creates mapping in Table Storage

# 4. Verify mapping was created
az storage entity query \
  --account-name <your-storage> \
  --table-name UserMappings
```

---

## Testing Scenarios

### Scenario 1: First-Time User

**Expected Flow**:
1. User visits `/api/Login`
2. Redirects to Azure AD login
3. After Azure AD auth, redirects to GitHub OAuth
4. After GitHub auth, user mapping created
5. User added to organization
6. User added to "Active-Session-Users" team

**Verify**:
```bash
# Check user was added to org
gh api "/orgs/oregonstate-ai/members/{username}"

# Check user is in team
gh api "/orgs/oregonstate-ai/teams/active-session-users/memberships/{username}"

# Check database mapping
az storage entity query \
  --account-name <storage> \
  --table-name UserMappings
```

### Scenario 2: Returning User (24h Later)

**Expected Flow**:
1. Audit function runs every 15 minutes
2. Detects lease expired (>24h)
3. Removes user from team (Soft Lock)
4. User gets 404 on private repos
5. User visits `/api/Login` again
6. Re-authenticated with Azure AD + Duo
7. Added back to team immediately
8. Access restored

**Verify**:
```bash
# Simulate lease expiration by updating Timestamp
az storage entity update \
  --account-name <storage> \
  --table-name UserMappings \
  --partition-key oregonstate-ai \
  --row-key "user@example.com" \
  --entity 'Timestamp=2020-01-01T00:00:00Z'

# Run audit function (normally every 15 min)
# Manually trigger: POST /api/Audit

# Check user removed from team
gh api "/orgs/oregonstate-ai/teams/active-session-users/memberships/{username}" || echo "User not in team"
```

### Scenario 3: Terminated Employee

**Expected Flow**:
1. HR disables user in Azure AD
2. Audit function runs
3. Detects AD account disabled
4. Removes user from organization entirely (Hard Kick)
5. Deletes from database
6. User removed from all teams

**Verify**:
```bash
# Simulate disabled AD account by marking as inactive
# In real scenario: disable in Azure AD portal

# Run audit function
# Manually trigger audit to see effect

# Check user removed from org
gh api "/orgs/oregonstate-ai/members/{username}" || echo "User not in org"

# Check database record deleted
az storage entity query \
  --account-name <storage> \
  --table-name UserMappings \
  --filter "rowKey eq 'disabled@example.com'" || echo "Record deleted"
```

---

## Jest Unit Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test File

```bash
npm test -- tests/auth-callback.test.js
```

### Run with Coverage

```bash
npm test -- --coverage
# Shows coverage for functions, shared utilities
```

### Watch Mode (Auto-run on file changes)

```bash
npm run test:watch
```

### Test Files

- `tests/login.test.js` - Login function tests
- `tests/auth-callback.test.js` - OAuth callback tests
- `tests/audit.test.js` - Lease enforcement and offboarding
- `tests/github-webhook.test.js` - Webhook signature validation
- `tests/health-check.test.js` - System health checks

---

## Postman Collection Testing

### Import Collection

1. Open Postman
2. File → Import
3. Select `postman/github-identity-bridge.postman_collection.json`
4. Create environment from `postman/github-identity-bridge.postman_environment.json`

### Available Requests

- **Login** - GET /api/Login (initiates OAuth)
- **AuthCallback (Mock Azure AD)** - GET /api/AuthCallback with mock code
- **AuthCallback (Mock GitHub)** - GET /api/AuthCallback with mock GitHub code
- **HealthCheck** - GET /api/HealthCheck
- **GitHub Webhook** - POST /api/GithubWebhook with mock signature

### Pre-request Scripts

Pre-scripts handle:
- Mock OAuth code generation
- HMAC signature generation for webhooks
- Request body sanitization

---

## Troubleshooting

### "Cannot connect to Table Storage"

**Local Development**:
```bash
# Option 1: Use Azure Storage Emulator
# Install and run: https://github.com/Azure/Azurite

# Option 2: Use mock mode
# Set USE_MOCK_OAUTH=true in local.settings.json
```

### "GitHub App permissions error"

```bash
# Verify GitHub App has correct permissions
gh api "/app" | jq '.permissions'

# Should show:
# - members: write
# - team_members: write
```

### "Azure AD token validation fails"

```bash
# Verify JWT can be decoded
# Visit: https://jwt.io
# Paste ID token from Azure
# Check expiration time (exp claim)
```

### "Mock OAuth not working"

```bash
# Verify setting
cat local.settings.json | grep USE_MOCK_OAUTH

# Should see: "USE_MOCK_OAUTH": "true"

# Restart functions
npm start
```

### "Audit function not triggered"

**For local testing** (timer triggers don't run in `func start`):
```bash
# Manually trigger audit logic
# Create test script or curl the functions

# In production, Azure handles timer triggers automatically
```

---

## Load Testing

### Simple Load Test with Apache Bench

```bash
# Test /api/HealthCheck with 100 concurrent requests
ab -n 1000 -c 100 http://localhost:7071/api/HealthCheck

# Expected: <100ms per request in mock mode
```

### Stress Test User Creation

```bash
# Create 100 test users
for i in {1..100}; do
  curl -X GET "http://localhost:7071/api/Login?email=testuser$i@example.com"
done

# Verify mappings created
az storage entity query \
  --account-name <storage> \
  --table-name UserMappings | wc -l
```

---

## Debugging Tips

### Enable Debug Logging

```bash
# In local.settings.json
"DEBUG": "true"

# Functions now log detailed information
```

### View Logs

**Local Development**:
```bash
# Logs appear in terminal where you ran `npm start`
# Look for [INFO], [ERROR], [DEBUG] prefixes
```

**Azure Production**:
```bash
# View real-time logs
az webapp log tail \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg

# View historical logs
az monitor metrics list \
  --resource /subscriptions/<sub>/resourceGroups/github-identity-bridge-rg/providers/Microsoft.Web/sites/github-identity-bridge-app
```

### Inspect Database Records

```bash
# List all user mappings
az storage entity query \
  --account-name <storage> \
  --table-name UserMappings --output table

# List audit logs (last hour)
az storage entity query \
  --account-name <storage> \
  --table-name AuditLogs \
  --filter "Timestamp gt datetime'$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ')'"
```

### Validate Webhook Signature

```bash
# Generate test signature
PAYLOAD='{"action":"added"}'
SECRET='webhook-secret'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* /sha256=/')

echo "Payload: $PAYLOAD"
echo "Expected Signature: $SIGNATURE"

# Send and check response
curl -X POST http://localhost:7071/api/GithubWebhook \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -H "X-GitHub-Event: member" \
  -d "$PAYLOAD"
```

---

## Continuous Integration

### GitHub Actions Workflow Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test -- --coverage
      - run: npm run lint
```

---

## Reporting Issues

When reporting bugs, include:
1. **Environment**: Node version, OS, platform (local/Azure)
2. **Reproduction steps**: Exact steps to reproduce
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happened
5. **Logs**: Error messages and stack traces
6. **Screenshot**: If applicable

Example:
```
Title: "First-time user flow fails with 'Invalid GitHub state'"

Environment: Node 18, macOS, local development

Reproduction:
1. Set USE_MOCK_OAUTH=true
2. Visit http://localhost:7071/api/Login
3. See error "Invalid GitHub state"

Expected: Should create mock user mapping

Actual: Error page with "Invalid state parameter"

Logs:
[ERROR] AuthCallback error - Invalid state parameter: github_init|

Version: v1.0.0
```
