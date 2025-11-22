# API Documentation

## Endpoints

### Login
**Initiates Azure AD authentication flow**

```http
GET /api/Login?email=optional@example.com
```

**Response**: 302 redirect to Azure AD login or mock OAuth endpoint

**Example**:
```bash
curl http://localhost:7071/api/Login
# Redirects to Azure AD login page
```

---

### AuthCallback
**Handles OAuth callbacks from both Azure AD and GitHub**

```http
GET /api/AuthCallback?code=<auth-code>&state=<state>
```

**Parameters**:
- `code` (required): OAuth authorization code from provider
- `state` (required): OAuth state parameter (azure_init or github_init|email)

**Flow**:
1. **Azure AD Callback** (`state=azure_init`):
   - Exchanges code for Azure AD token
   - Extracts user email
   - Checks if user already linked
   - If linked: Updates last login, returns success page
   - If not linked: Redirects to GitHub OAuth

2. **GitHub Callback** (`state=github_init|{email}`):
   - Exchanges code for GitHub access token
   - Gets GitHub user info
   - Creates user mapping in database
   - Adds user to organization
   - Adds user to gatekeeper team
   - Returns success page

**Response**: 200 HTML success page or 302 redirect to GitHub

**Example**:
```bash
# After GitHub OAuth
curl "http://localhost:7071/api/AuthCallback?code=ghu_xxx&state=github_init%7Cuser%40example.com"
```

---

### HealthCheck
**Verifies system connectivity and configuration**

```http
GET /api/HealthCheck
```

**Response**: 200 JSON

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "environment": {
    "NODE_ENV": "development",
    "USE_MOCK_OAUTH": true,
    "GITHUB_ORG_NAME": "oregonstate-ai"
  },
  "credentials": {
    "azureAdConfigured": true,
    "githubOAuthConfigured": true,
    "githubAppConfigured": true,
    "storageConfigured": true
  },
  "services": {
    "database": "connected",
    "appInsights": true
  }
}
```

**Example**:
```bash
curl http://localhost:7071/api/HealthCheck | jq
```

---

### GitHub Webhook
**Receives GitHub App events**

```http
POST /api/GithubWebhook
X-Hub-Signature-256: sha256=<hmac>
X-GitHub-Event: <event-type>

{ payload }
```

**Headers** (validated):
- `X-Hub-Signature-256`: HMAC-SHA256 signature of request body
- `X-GitHub-Event`: Event type (member, organization, etc.)

**Supported Events**:
- `member` - User added/removed from organization
- `organization` - Organization membership changes

**Response**: 200 JSON

```json
{
  "success": true
}
```

**Security**:
- HMAC signature validated against `GITHUB_APP_WEBHOOK_SECRET`
- Invalid signatures return 403 Forbidden
- Always returns 200 to prevent GitHub retries

**Example**:
```bash
# Generate signature
PAYLOAD='{"action":"added","member":{"login":"testuser"}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "webhook-secret" | sed 's/^.* /sha256=/')

# Send webhook
curl -X POST http://localhost:7071/api/GithubWebhook \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -H "X-GitHub-Event: member" \
  -d "$PAYLOAD"
```

---

## Data Structures

### User Mapping
**Stored in Azure Table Storage - UserMappings table**

```json
{
  "partitionKey": "oregonstate-ai",
  "rowKey": "user@example.com",
  "GitHubUsername": "testuser",
  "LastLoginTimestamp": "2024-01-15T10:30:00Z",
  "IsActive": true,
  "CreatedAt": "2024-01-01T08:00:00Z",
  "Timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Audit Log
**Stored in Azure Table Storage - AuditLogs table**

```json
{
  "partitionKey": "oregonstate-ai",
  "rowKey": "1705315800000-abc123def",
  "Event": "USER_AUTHENTICATED",
  "Details": "{\"email\":\"user@example.com\",\"githubUsername\":\"testuser\"}",
  "Timestamp": "2024-01-15T10:30:00Z"
}
```

**Event Types**:
- `USER_LINKED` - User account linked
- `USER_REAUTHENTICATED` - User re-authenticated within 24h
- `USER_SOFT_LOCKED` - User lease expired
- `USER_HARD_KICKED` - User removed from organization
- `GITHUB_MEMBER_ADDED` - GitHub event: member added
- `GITHUB_MEMBER_REMOVED` - GitHub event: member removed
- `AUDIT_SUMMARY` - 15-min audit summary

---

## Mock OAuth Usage

When `USE_MOCK_OAUTH=true`, OAuth flows use mock data instead of real providers.

**Mock Login Endpoint**:
```bash
# Uses mock Azure AD and GitHub users
curl http://localhost:7071/api/Login
# Returns mock tokens instead of redirecting to real providers
```

**Mock Test User**:
```
Corporate Email: test@oregonstate.edu
GitHub Username: testuser
AD Status: active
```

**Custom User**:
```bash
# Pass email as query parameter
curl "http://localhost:7071/api/Login?email=custom@example.com"
# Creates mock user with that email
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | AuthCallback success page, HealthCheck |
| 302 | Redirect | Login to Azure AD |
| 400 | Bad Request | Missing required parameters |
| 403 | Forbidden | Invalid webhook signature |
| 500 | Server Error | Database connection failed |

### Error Response Format

```json
{
  "error": "Authentication failed",
  "message": "Invalid OAuth code"
}
```

---

## Rate Limits

- **GitHub API**: 5,000 requests/hour (per authenticated user)
- **Azure AD**: 1,500 requests/minute
- **Table Storage**: No enforced limits (pay-per-use)

---

## Testing

### Local Testing with Mock OAuth

```bash
# Set in local.settings.json
"USE_MOCK_OAUTH": "true"

# Start local functions
npm start

# Test Login
curl http://localhost:7071/api/Login

# Test HealthCheck
curl http://localhost:7071/api/HealthCheck

# Simulate OAuth callback
curl "http://localhost:7071/api/AuthCallback?code=mock-test@example.com&state=azure_init"
```

### Real OAuth Testing

See [TESTING.md](TESTING.md) for full setup guide with real Azure AD and GitHub credentials.

---

## Audit Trail

All authentication and access events are logged to `AuditLogs` table with:
- **Timestamp**: ISO 8601 format
- **Event**: Event type (see Event Types above)
- **Details**: JSON payload with event details

Query audit logs:
```bash
# List recent events (from local.settings.json connection string)
az storage entity query \
  --account-name <storage> \
  --table-name AuditLogs \
  --filter "partitionKey eq 'oregonstate-ai'"
```
