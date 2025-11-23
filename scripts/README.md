# Scripts Directory

Utility scripts for deployment and local development.

## 🔧 Available Scripts

### `setup-github-org.sh`
Configures GitHub organization security settings for the Identity Bridge system.

**Usage:**
```bash
# Option 1: Use environment variable
export GITHUB_ORG_NAME=oregonstate-ai
./scripts/setup-github-org.sh

# Option 2: Use .env file (automatic)
# Script will read from .env if GITHUB_ORG_NAME not set
./scripts/setup-github-org.sh
```

**What it does:**
- ✅ Sets organization base permissions to "none" (Default Deny)
- ✅ Disables member repository creation
- ✅ Creates/verifies "Active-Session-Users" gatekeeper team
- ✅ Checks 2FA requirement status
- 📋 Provides next steps for repository access and 2FA

**⚠️ Manual step required:**
- 2FA requirement must be enabled in GitHub portal (API doesn't allow this for security)
- Visit: https://github.com/organizations/{org}/settings/security

---

### `generate-local-settings.sh`
Converts a `.env` file to the `local.settings.json` format required by Azure Functions Core Tools.

**Usage:**
```bash
# 1. Create your .env file
cp .env.default .env

# 2. Edit .env and fill in your values
nano .env  # or use your preferred editor

# 3. Generate local.settings.json
./scripts/generate-local-settings.sh

# 4. Start local development
func start
```

**What it does:**
- Reads environment variables from `.env`
- Converts to Azure Functions `local.settings.json` format
- Adds required Azure Functions runtime settings
- Enables CORS for local development

### `deploy.sh`
Automated deployment script for Azure infrastructure and application.

### `cleanup.sh`
Removes Azure resources when no longer needed.

### `setup-local.sh`
Sets up local development environment.

---

## 📝 Configuration File Hierarchy

1. **`.env.default`** (checked into git)
   - Complete template with all variables
   - Detailed instructions for each credential
   - Single source of truth

2. **`.env`** (gitignored)
   - Your local copy with actual values
   - Generated from: `cp .env.default .env`
   - Used by `generate-local-settings.sh`

3. **`local.settings.json`** (gitignored, auto-generated)
   - Azure Functions Core Tools format
   - Generated from: `./scripts/generate-local-settings.sh`
   - Used by: `func start`

**Why this approach?**
- Single source of truth (`.env.default`)
- No duplicate configuration files to maintain
- Automatic conversion between formats
- Secrets never committed to git
