# GitHub Identity Bridge & Governance System

A serverless application that bridges enterprise Azure Active Directory authentication with GitHub organization access, enabling enterprise-grade security controls (SSO, 2FA, audit logging) on standard GitHub without requiring GitHub Enterprise Cloud.

## Quick Start

### Prerequisites

- **Azure CLI**: `az login` (already authenticated in development environment)
- **GitHub CLI**: `gh auth login` (already authenticated)
- **Node.js**: 20.x LTS (⚠️ NOT 18 or 24)
- **Azure Functions Core Tools**: 4.x (installation instructions below)
- **npm**: 9.x or higher

### Installing Azure Functions Core Tools

Azure Functions Core Tools is required to run `func start` for local development.

**Ubuntu/Debian:**
```bash
# 1. Add Microsoft package repository GPG key
curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg

# 2. Add APT source (Ubuntu)
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs 2>/dev/null)-prod $(lsb_release -cs 2>/dev/null) main" > /etc/apt/sources.list.d/dotnetdev.list'

# OR for Debian:
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/debian/$(lsb_release -rs 2>/dev/null | cut -d'.' -f 1)/prod $(lsb_release -cs 2>/dev/null) main" > /etc/apt/sources.list.d/dotnetdev.list'

# 3. Update and install
sudo apt-get update
sudo apt-get install azure-functions-core-tools-4

# 4. Verify installation
func --version
```

**macOS:**
```bash
brew tap azure/functions
brew install azure-functions-core-tools@4
```

**Windows:**
Download installer from: https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local

**Supported Linux Versions:**
- Ubuntu: 24.04 (noble), 22.04 (jammy), 20.04 (focal), 18.04 (bionic)
- Debian: 12 (bookworm), 11 (bullseye), 10 (buster)

---

### Local Development (5 minutes)

```bash
# 1. Clone repository
git clone <repo-url>
cd git-carded

# 2. Set up configuration
cp .env.default .env
# Edit .env if needed (USE_MOCK_OAUTH=true is already set for testing)

# 3. Generate Azure Functions config
./scripts/generate-local-settings.sh

# 4. Install dependencies
npm install

# 5. Start local Azure Functions
func start
# Functions will run at: http://localhost:7071

# 6. Test the portal
# Visit: http://localhost:7071/api/login (will use mock OAuth)
# Visit: http://localhost:7071/api/healthcheck (verify connectivity)
```

**📖 For detailed script documentation, see [scripts/README.md](scripts/README.md)**

### Deployment to Azure (10 minutes)

```bash
# 1. Prepare credentials
# - Create Azure App Registration (see CLAUDE.md)
# - Create GitHub OAuth App (see CLAUDE.md)
# - Create GitHub App for bot operations (see CLAUDE.md)

# 2. Run deployment script
chmod +x scripts/deploy.sh
./scripts/deploy.sh

# 3. Set secrets in Azure Portal or via Azure CLI
az functionapp config appsettings set \
  --name github-identity-bridge-app \
  --resource-group github-identity-bridge-rg \
  --settings AZURE_TENANT_ID=xxx GITHUB_APP_ID=xxx ...

# 4. Configure GitHub Organization
# - Set Base Permissions to "None"
# - Enable 2FA requirement
# - Update GitHub App webhook URL
```

## Features

✅ **Enterprise SSO**: Force Azure AD + Duo 2FA authentication
✅ **24-Hour Leases**: Access expires daily, users must re-authenticate
✅ **Soft Lock**: Expired leases remove team membership but preserve history
✅ **Hard Kick**: Terminated employees instantly lose all access
✅ **Audit Logging**: All authentication and access events tracked
✅ **Mock OAuth**: Test locally without real Azure/GitHub credentials
✅ **Serverless**: Azure Functions + Table Storage (pay-per-use)
✅ **Fully Automated**: Deploy via Bicep + CLI scripts

## Project Structure

```
git-carded/
├── 📄 Configuration
│   ├── host.json              # Azure Functions host config
│   ├── package.json           # Node.js dependencies (no "main" property!)
│   ├── .env.default           # Environment template with instructions
│   └── main.bicep             # Azure infrastructure (IaC)
│
├── 🔧 Function Endpoints (at root level)
│   ├── Login/                 # Initiates Azure AD OAuth
│   ├── AuthCallback/          # Handles OAuth callbacks
│   ├── Audit/                 # 15-min timer trigger (enforces leases)
│   ├── GithubWebhook/         # Receives GitHub events
│   ├── HealthCheck/           # System health check
│   ├── SanityCheck/           # Infrastructure test
│   └── Diagnostic/            # Environment check
│
├── 📦 Shared Utilities
│   └── shared/
│       ├── database.js        # Azure Table Storage client
│       ├── github.js          # GitHub API wrapper
│       ├── azure-ad.js        # Azure AD OAuth
│       ├── logger.js          # Application Insights logging
│       └── mock-oauth.js      # Mock OAuth for testing
│
├── 🛠️ Scripts
│   ├── scripts/
│   │   ├── deploy.sh          # Deploy to Azure
│   │   ├── cleanup.sh         # Remove all resources
│   │   ├── generate-local-settings.sh  # Convert .env to local.settings.json
│   │   └── README.md          # 📖 Scripts documentation
│
├── 📚 Documentation
│   ├── CLAUDE.md              # Complete architecture & deployment guide
│   ├── docs/
│   │   ├── API.md             # API endpoint documentation
│   │   └── TESTING.md         # Manual testing guide
│
└── 🧪 Development
    ├── local-server.js        # Simple dev server (no func CLI needed)
    └── local.settings.json    # Auto-generated (see scripts/README.md)
```

## Architecture Overview

### Components

1. **Web Portal** (Azure Functions HTTP Triggers)
   - `/api/Login` - Initiates Azure AD OAuth
   - `/api/AuthCallback` - Handles OAuth callbacks from Azure AD and GitHub
   - `/api/HealthCheck` - System health check

2. **Background Auditor** (Azure Functions Timer Trigger)
   - Runs every 15 minutes
   - Checks Azure AD user status via Microsoft Graph API
   - Enforces 24-hour lease expiration (Soft Lock)
   - Removes terminated users (Hard Kick)
   - Uses GitHub API to manage team/org membership

3. **Database** (Azure Table Storage)
   - `UserMappings` - Corporate email ↔ GitHub username mappings
   - `Sessions` - OAuth session state
   - `AuditLogs` - All authentication and access events

### Security Model

- **Default Deny**: Organization base permissions set to "None"
- **Gatekeeper Team**: Only "Active-Session-Users" team has repository access
- **Daily Lease**: Access expires every 24 hours (requires Azure AD + Duo re-auth)
- **Soft Lock**: Expired leases remove from team only (preserves history)
- **Hard Kick**: Terminated AD accounts removed from organization entirely

## Testing

### Mock OAuth (No Real Credentials Required)

```bash
# In local.settings.json, set:
"USE_MOCK_OAUTH": "true"

# Then visit:
# http://localhost:7071/api/Login
# Will use mock Azure AD and GitHub users
```

### Unit Tests

```bash
# Run Jest test suite
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

### Manual Testing

See [docs/TESTING.md](docs/TESTING.md) for detailed step-by-step manual testing guide.

### Postman Collection

See [postman/](postman/) for API collection with mock OAuth pre-configured.

## Configuration

### Environment Variables

All configuration is managed via environment variables. See `.env.default` for complete template with instructions.

**Critical Variables**:
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_CLIENT_ID` - App registration client ID
- `GITHUB_APP_ID` - GitHub App ID
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key (PEM format)
- `GITHUB_ORG_NAME` - Target organization (YourOrganization)

See [CLAUDE.md](CLAUDE.md) for complete environment variable documentation.

## API Endpoints

### Login
```http
GET /api/Login
```
Initiates Azure AD OAuth flow. Redirects user to Microsoft login.

### AuthCallback
```http
GET /api/AuthCallback?code=...&state=...
```
Handles OAuth callback from both Azure AD and GitHub.

### HealthCheck
```http
GET /api/HealthCheck
```
Returns system health status and connectivity checks.

### GitHub Webhook
```http
POST /api/GithubWebhook
X-Hub-Signature-256: sha256=...
```
Receives GitHub events. HMAC signature validated.

See [docs/API.md](docs/API.md) for detailed API documentation.

## Deployment

### One-Command Deployment

```bash
./scripts/deploy.sh
```

This orchestrates:
1. Azure CLI authentication verification
2. Resource group creation
3. Bicep infrastructure deployment
4. npm dependency installation
5. Function App code deployment
6. GitHub team creation

### Cleanup

To remove all resources:

```bash
./scripts/cleanup.sh
```

Removes:
- Azure Resource Group (all resources)
- GitHub team
- GitHub App (manual step)

## Troubleshooting

### Common Issues

**"Local development not working"**
- Ensure `USE_MOCK_OAUTH=true` in local.settings.json
- Visit http://localhost:7071/api/HealthCheck to verify

**"Authentication fails"**
- Check AZURE_CLIENT_ID and AZURE_CLIENT_SECRET
- Verify GitHub OAuth credentials
- Check REDIRECT_URI matches registered app

**"Database connection error"**
- Verify AzureWebJobsStorage connection string
- For local dev, ensure Azure Storage Emulator is running or use mock mode

**"GitHub operations fail"**
- Verify GitHub App installation in organization
- Check GitHub App ID and private key
- Confirm GitHub team exists and has repository access

See [docs/TESTING.md](docs/TESTING.md) for more debugging tips.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture, deployment strategy, and troubleshooting guide
- **[scripts/README.md](scripts/README.md)** - Configuration scripts and workflow
- **[docs/API.md](docs/API.md)** - API endpoint documentation
- **[docs/TESTING.md](docs/TESTING.md)** - Manual testing guide and troubleshooting

## Security

- **No secrets in git** - Use `.env.local` or Azure Key Vault
- **Managed Identity** - Azure Functions use system-assigned identity for storage access
- **HMAC validation** - GitHub webhooks validated with secret
- **JWT validation** - Azure AD tokens properly validated
- **HTTPS only** - Production deployment enforces HTTPS
- **Audit logging** - All actions logged with timestamps

## Compliance Features

- **Access Logs**: Database provides timestamp of each SSO authentication
- **Activity Tracking**: GitHub Webhook events logged for SIEM integration
- **Identity Mapping**: Strict 1:1 mapping (no account sharing)
- **Automatic Offboarding**: Terminated users lose access within 15 minutes

## Cost Estimate

**Azure Functions (Consumption Plan)**: ~$0-2/month
- 2,880 executions/month (every 15 min)
- 1-2 seconds per execution
- Well within free tier (1M executions included)

**Azure Storage**: ~$1-5/month
- Table Storage costs pennies per million operations

**Azure Application Insights**: ~$0-5/month (included in Functions)

**Total**: ~$1-10/month vs. $21/user/month for GitHub Enterprise

## License

MIT

## Support

For issues, questions, or contributions, please open a GitHub issue in this repository.
