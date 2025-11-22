# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**GitHub Identity Bridge & Governance System** - A serverless application that bridges enterprise Azure Active Directory authentication with GitHub organization access, enabling enterprise-grade security controls (SSO, 2FA, audit logging) on standard GitHub without requiring GitHub Enterprise Cloud.

## Development Environment

**CLI Authentication Status**:
- ✅ **Azure CLI**: Authenticated and ready (`az account show`)
- ✅ **GitHub CLI**: Authenticated and ready (`gh auth status`)

This enables **fully automated deployment** via command-line tools without manual portal interactions. All infrastructure provisioning and GitHub organization setup can be scripted.

### Core Concept

The system acts as an "Identity Bridge" rather than a network proxy, providing a "ticket vending machine" approach where:
- Users authenticate via corporate Azure AD (with Duo 2FA)
- GitHub accounts are linked to corporate identities in a database
- Access to GitHub organization repositories is granted temporarily (24-hour lease)
- Background auditor enforces access policies automatically

### Security Model: "Default Deny" + Team-Based Access Control

1. **Base Permissions**: Organization base permissions set to "None" - being an org member grants zero access
2. **Gatekeeper Team**: A single team (e.g., "Active-Session-Users") is the ONLY entity granted repository access
3. **24-Hour Lease**: Access expires daily, requiring Azure AD + Duo re-authentication
4. **Soft Lock**: Expired leases remove team membership only (preserves org membership, history, and assignments)
5. **Hard Kick**: Disabled AD accounts trigger complete org removal (permanent revocation)

## Architecture

### Target Platform: Azure Serverless

- **Compute**: Azure Functions (event-driven, pay-per-use)
- **Database**: Azure Table Storage (NoSQL key-value store)
  - Schema: `PartitionKey: oregonstate-ai | RowKey: CorpEmail | Columns: GitHubUsername, LastLoginTimestamp, IsActive`
- **Authentication**: Microsoft Entra ID (Azure AD) for corporate SSO
- **Orchestration**: Timer triggers (15-minute intervals for audit enforcement)
- **Security**: Managed Identity for secure Azure service-to-service authentication
- **Region**: West US 2
- **Resource Naming**: `github-identity-bridge-*` prefix

### Key Components

1. **Web Portal** (Azure Functions - HTTP Triggers)
   - `/Login` endpoint: Initiates Azure AD OAuth flow
   - `/AuthCallback` endpoint: Handles OAuth callbacks from both Azure AD and GitHub
   - Links corporate email ↔ GitHub username

2. **Background Auditor** (Azure Function - Timer Trigger)
   - Runs every 15 minutes
   - Checks Azure AD account status via Microsoft Graph API
   - Enforces 24-hour lease expiration (Soft Lock)
   - Removes terminated users (Hard Kick)
   - Uses GitHub API (`@octokit/rest`) to manage team/org membership

3. **Database** (Azure Table Storage)
   - Table name: `UserMappings`
   - Stores identity mappings and last authentication timestamp

### Critical GitHub Organization Configuration

**Organization Settings** → **Member privileges** → **Base permissions**: "None"
- This is the foundation of the security model - grants zero default access

**Team Setup**: Create "Active-Session-Users" team
- Grant this team (not individuals) Read/Write access to all repositories (public and private)
- All access flows exclusively through this team

**Organization Settings** → **Authentication security**: "Require two-factor authentication"
- Forces GitHub-side 2FA even if user's personal account is compromised

## User Workflows

### First-Time Setup (Day 1)
1. User visits Identity Bridge Portal
2. Redirects to Azure AD login (enforces corporate password + Duo 2FA)
3. After AD auth, prompts "Connect GitHub Account" (GitHub OAuth)
4. System stores mapping in database
5. Bot invites user to GitHub org AND adds to "Active-Session-Users" team
6. User gains immediate access to repositories

### Daily Re-Authentication (Day 2+)
1. After 24 hours, background auditor removes user from "Active-Session-Users" team (Soft Lock)
2. User remains in org (preserves history) but sees 404 on private repos
3. User visits portal, re-authenticates with Azure AD + Duo
4. System adds user back to team immediately
5. Access restored without email invitations or delays

### Termination
1. HR disables user in Active Directory
2. Within 15 minutes, auditor detects disabled status via Graph API
3. System removes user completely from GitHub org (Hard Kick)
4. Record deleted from database

## Repository Access Matrix

| Repository Type | Active Lease (< 24h) | Expired Lease (Soft Lock) | Terminated (Hard Kick) |
|----------------|---------------------|---------------------------|------------------------|
| **Private**    | Read/Write          | 404 (invisible)           | 404 (removed from org) |
| **Public**     | Read/Write (push)   | Read-only (no push)       | Read-only (no push)    |

**Key Insight**: Public repos remain visible after Soft Lock but write access is revoked. Private repos become completely invisible.

## GitHub App Setup (Detailed Portal Guide)

**Creating the GitHub App** (for bot operations):

1. Navigate to: `https://github.com/organizations/oregonstate-ai/settings/apps` (or Settings → Developer settings → GitHub Apps → New GitHub App)

2. **App name**: `github-identity-bridge`

3. **Homepage URL**: `https://github-identity-bridge-app.azurewebsites.net`

4. **Webhook URL**: `https://github-identity-bridge-app.azurewebsites.net/api/GithubWebhook` (leave blank for now if not deployed)

5. **Webhook secret**: Generate a strong random string, store in `GITHUB_APP_WEBHOOK_SECRET` env var

6. **Organization permissions**:
   - `Members`: Read & Write (required to invite/remove users)
   - `Team members`: Read & Write (required to manage team membership)
   - `Teams`: Read & Write (required to create/modify teams)

7. **User permissions**:
   - `User data`: Read-only (to get user info after OAuth)

8. **Webhook events** (subscribe to):
   - `member` (tracks user added/removed)
   - `organization` (optional: tracks org changes)

9. **Where can this app be installed**: "Only on this account"

10. Click **Create GitHub App**

11. **Generate Private Key**: Scroll down to "Private keys" → Click "Generate a private key" → Save the `.pem` file securely

12. **Note these values**:
   - App ID (visible at top of page)
   - Installation ID (visible in "Installations" tab after installing)
   - Private Key (from the downloaded .pem file)

13. **Install the app** on `oregonstate-ai` organization:
    - Click "Install App" in left menu
    - Select "oregonstate-ai"
    - Review permissions
    - Click "Install"
    - Note the Installation ID from the URL

**Store securely in environment variables**:
```bash
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=99999999
GITHUB_APP_WEBHOOK_SECRET=your-random-webhook-secret
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----"
```

## Development Commands

For local development and testing:

### Local Development
```bash
# Initialize Azure Function (when creating)
func init --worker-runtime node --language javascript

# Install dependencies (Node.js example)
npm install @azure/data-tables @octokit/rest axios cookie querystring dotenv

# Run locally
func start

# Test functions at: http://localhost:7071/api/{FunctionName}
```

### Azure CLI Deployment

**Note**: Azure CLI and GitHub CLI are already authenticated in this environment. No `az login` or `gh auth login` needed.

```bash
# Verify authentication (optional)
az account show
gh auth status

# Create resource group (West US 2 region)
az group create --name github-identity-bridge-rg --location westus2

# Create storage account (must be globally unique)
az storage account create \
  --name github-identity-bridge-storage \
  --location westus2 \
  --resource-group github-identity-bridge-rg \
  --sku Standard_LRS

# Create Function App
az functionapp create \
  --resource-group github-identity-bridge-rg \
  --consumption-plan-location westus2 \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name github-identity-bridge-app \
  --storage-account github-identity-bridge-storage

# Deploy code
func azure functionapp publish github-identity-bridge-app

# Set environment variables (secrets) - use Azure Key Vault in production
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings AZURE_TENANT_ID=... GITHUB_APP_ID=... # etc.
```

## Automated Setup Capabilities

With pre-authenticated CLIs, the following can be fully automated:

**Azure Infrastructure** (via `az` CLI):
- Resource group creation
- Storage account provisioning
- Function App deployment
- Managed Identity configuration
- Environment variable configuration

**GitHub Organization Setup** (via `gh` CLI):
- Team creation (`gh api /orgs/{org}/teams`)
- Organization settings configuration
- Repository permission assignments
- Webhook configuration for audit logging

## Required Azure Credentials

### Azure App Registration (for Portal)
1. Navigate to portal.azure.com → "App registrations"
2. Create new registration:
   - Name: "GitHub-Governance-Portal"
   - Account type: Single tenant
   - Redirect URI: `http://localhost:7071/api/AuthCallback` (dev) or production URL
3. Copy: `Application (client) ID`, `Directory (tenant) ID`
4. Generate client secret: Certificates & secrets → New client secret

### GitHub OAuth App (for Linking)
1. GitHub Organization Settings → Developer settings → OAuth Apps → New OAuth App
2. Copy: `Client ID`, `Client Secret`
3. Authorization callback URL must match Azure function URL

### GitHub App (for Bot Operations)
Instead of using a Personal Access Token, we use a GitHub App for better security and audit trails.

**Setup Steps**:
1. Go to your GitHub Organization Settings → Developer settings → GitHub Apps → New GitHub App
2. Fill in:
   - **App name**: `github-identity-bridge`
   - **Homepage URL**: `https://github-identity-bridge-app.azurewebsites.net`
   - **Webhook URL**: `https://github-identity-bridge-app.azurewebsites.net/api/GithubWebhook`
   - **Webhook active**: Enable
3. Grant permissions:
   - **Organization permissions**:
     - `Members`: Read & Write (invite/remove users)
     - `Team members`: Read & Write (manage team membership)
   - **User permissions**:
     - `User data`: Read-only (get user info)
4. Subscribe to webhook events:
   - `member` (when user added/removed from org)
5. Create private key and download `.pem` file
6. Install app on `oregonstate-ai` organization

**Store credentials as environment variables**:
- `GITHUB_APP_ID`: The App ID number
- `GITHUB_APP_PRIVATE_KEY`: Contents of the `.pem` file (or base64 encoded)
- `GITHUB_APP_INSTALLATION_ID`: Installation ID (found in URL after installation)

## Environment Variables

Store in `local.settings.json` (local) or Function App Configuration (production):

```
# Azure AD (Portal Authentication)
AZURE_TENANT_ID              - Azure AD tenant ID
AZURE_CLIENT_ID              - App registration client ID
AZURE_CLIENT_SECRET          - App registration secret
REDIRECT_URI                 - OAuth callback URL (e.g., http://localhost:7071/api/AuthCallback)

# GitHub OAuth (Account Linking)
GITHUB_OAUTH_CLIENT_ID       - GitHub OAuth app client ID
GITHUB_OAUTH_CLIENT_SECRET   - GitHub OAuth app secret

# GitHub App (Bot Operations)
GITHUB_ORG_NAME              - Target GitHub organization (oregonstate-ai)
GITHUB_APP_ID                - GitHub App ID
GITHUB_APP_PRIVATE_KEY       - GitHub App private key (PEM format)
GITHUB_APP_INSTALLATION_ID   - GitHub App installation ID for the org
GITHUB_GATEKEEPER_TEAM_SLUG  - Team slug for access control (active-session-users)

# Azure Storage
AzureWebJobsStorage          - Storage account connection string
FUNCTIONS_WORKER_RUNTIME     - "node"
```

## Implementation Logic

### Soft Lock vs Hard Kick (Critical Distinction)

**Soft Lock** (Expired Lease):
- **Action**: Remove from "Active-Session-Users" team ONLY
- **Preserves**: Org membership, issue assignments, PR history, comments
- **Effect**: Private repos become invisible (404); public repos read-only
- **Trigger**: LastLoginTimestamp > 24 hours
- **Reversible**: User re-authenticates → instantly added back to team

**Hard Kick** (Termination):
- **Action**: Remove from organization entirely + delete database record
- **Trigger**: Azure AD accountEnabled = false
- **Effect**: Complete access revocation, user must be re-invited if re-hired
- **Irreversible**: Requires new onboarding flow

### GitHub API Operations (Octokit)

**AuthCallback function** (on successful Azure AD + GitHub OAuth):
1. `octokit.rest.orgs.setMembershipForUser()` - Ensure user in org (invites if needed)
2. `octokit.rest.teams.addOrUpdateMembershipForUserInOrg()` - Add to "Active-Session-Users" team
3. Update database: `LastLoginTimestamp = now()`

**Audit function** (timer trigger, every 15 minutes):
```
For each user in database:
  1. Query Azure AD: GET https://graph.microsoft.com/v1.0/users/{email}

  2. If accountEnabled = false (TERMINATED):
     → octokit.rest.orgs.removeMembershipForUser() [Hard Kick]
     → Delete from database

  3. If accountEnabled = true AND (now - LastLoginTimestamp) > 24h (EXPIRED):
     → octokit.rest.teams.removeMembershipForUserInOrg() [Soft Lock - team only]

  4. If accountEnabled = true AND lease valid:
     → octokit.rest.teams.addOrUpdateMembershipForUserInOrg() [Self-healing - ensure in team]
```

### Microsoft Graph API Access
The auditor needs to query AD user status. Use client credentials flow:
```
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
  grant_type=client_credentials
  client_id=...
  client_secret=...
  scope=https://graph.microsoft.com/.default

Then:
GET https://graph.microsoft.com/v1.0/users/{email}
  → Check: accountEnabled (bool)
```

## Security Considerations

1. **Secrets Management**: NEVER commit secrets to git
   - Local: Use `local.settings.json` (in .gitignore)
   - Production: Use Azure Function App Configuration or Azure Key Vault

2. **Managed Identity**: Enable system-assigned identity on Function App
   - Grants passwordless access to Azure Table Storage
   - Assign "Storage Table Data Contributor" role

3. **OAuth Security**:
   - HTTPS only in production (disable `allowHttpForRedirectUrl`)
   - Validate JWT tokens with proper libraries (e.g., `jsonwebtoken`, `msal-node`)
   - Never decode tokens manually with base64

4. **GitHub API**:
   - Use Personal Access Token (PAT) with minimal scopes: `admin:org`, `read:user`
   - Consider GitHub App instead of PAT for better security (future enhancement)
   - Implement exponential backoff for rate limiting

5. **Audit Trail**: Log all access grants/revocations with timestamps for compliance audits

## Compliance Features

- **Access Logs**: Database provides timestamp of each SSO authentication
- **Activity Tracking**: Configure GitHub Webhooks to send events to Azure Function for SIEM integration
- **Identity Mapping**: Strict 1:1 AD email ↔ GitHub username (prevents account sharing)
- **Automatic Offboarding**: Terminated users lose access within 15 minutes

## Programming Language & Stack

**Implementation Stack**:
- **Node.js 18** (Azure Functions runtime)
- **Express.js** (for HTTP triggers and session management)
- **Next.js** (optional: for future web portal UI dashboard, not part of initial Functions)

**Core Dependencies**:
- `@azure/data-tables` - Table Storage access
- `@octokit/rest` - GitHub API (using GitHub App authentication)
- `@octokit/auth-app` - GitHub App JWT generation and token management
- `axios` - HTTP requests to Graph API and OAuth providers
- `msal-node` - Microsoft Authentication Library for Azure AD OIDC
- `cookie` - Session cookie management
- `querystring` - URL encoding for OAuth flows
- `jsonwebtoken` - JWT validation

**Why Node.js over Python**:
- Best-in-class GitHub SDK: `@octokit/rest` (official & most maintained)
- Native JSON handling for API responses
- Fast cold-start times in Azure Functions (cost-effective)
- Rich OAuth ecosystem (`passport-azure-ad`, `msal-node`)
- Better async/await support for concurrent API calls

**Why NOT full Next.js initially**:
- Azure Functions are optimized for lightweight HTTP triggers
- Next.js is better for a separate web dashboard (can be added later)
- Focus on robust backend API first

## Complete Deployment Workflow

### Phase 1: Pre-Deployment Setup (Portal Configuration)

1. **Create Azure App Registration** (for portal authentication):
   - Navigate to `portal.azure.com` → "App registrations" → New registration
   - Name: `github-identity-bridge`
   - Account type: Single tenant
   - Redirect URI: `http://localhost:7071/api/AuthCallback` (dev) / production URL (prod)
   - Copy: Application ID, Tenant ID
   - Certificates & secrets → New client secret → Save the value

2. **Create GitHub OAuth App** (for account linking):
   - Settings → Developer settings → OAuth Apps → New OAuth App
   - Authorization callback URL: `https://github-identity-bridge-app.azurewebsites.net/api/AuthCallback`
   - Copy: Client ID, Client Secret

3. **Create GitHub App** (for bot operations):
   - Follow detailed guide in "GitHub App Setup (Detailed Portal Guide)" section above

### Phase 2: Local Development

```bash
# 1. Clone and initialize
git clone <repo>
cd git-carded
func init --worker-runtime node --language javascript
npm install

# 2. Create local.settings.json with all credentials from Phase 1
# (Template provided in repo, fill in your values)

# 3. Start local Azure Functions runtime
func start

# 4. Test the portal
# Visit: http://localhost:7071/api/Login
```

### Phase 3: Automated Deployment (Bicep + CLI)

```bash
# Deploy Azure infrastructure
az deployment group create \
  --resource-group github-identity-bridge-rg \
  --template-file main.bicep \
  --parameters region=westus2 \
                org=oregonstate-ai

# Deploy application code to Function App
func azure functionapp publish github-identity-bridge-app

# Set secrets in Function App (use Azure Key Vault in production)
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings @secrets.env
```

### Phase 4: Post-Deployment Setup (GitHub Organization)

```bash
# Create the Active-Session-Users team using GitHub CLI
gh api /orgs/oregonstate-ai/teams \
  -f name='Active-Session-Users' \
  -f description='Gatekeeper team for ID Bridge access' \
  -f privacy='closed'

# Set base org permissions to None (MANUAL: portal.github.com)
# Organization Settings → Member privileges → Base permissions → None

# Grant Active-Session-Users team access to repositories (MANUAL or automated)
# For each private repo:
gh api /repos/oregonstate-ai/{repo}/teams \
  -f team_slug='active-session-users' \
  -f permission='push'

# Enable org-wide 2FA requirement (MANUAL: portal.github.com)
# Organization Settings → Authentication security → Require two-factor authentication
```

## Why This Beats a Network Proxy

**Problems with Proxy Approach**:
- Requires SSL inspection (MITM attack on your own users)
- Breaks git CLI, VS Code, GitHub Copilot integration
- Cannot proxy SSH-based git operations
- Complex certificate management

**Identity Bridge Advantages**:
- No traffic interception - uses official GitHub APIs
- Native developer experience (full speed, no broken features)
- Works with all git protocols (HTTPS, SSH, IDE integrations)
- Simpler architecture, easier to audit
