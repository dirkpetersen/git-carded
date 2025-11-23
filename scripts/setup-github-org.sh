#!/bin/bash
# Setup GitHub Organization for Identity Bridge
# This script configures the critical security settings for the GitHub organization
#
# Prerequisites:
# - GitHub CLI authenticated: gh auth status
# - Admin access to the organization

set -e

# Load configuration from .env if GITHUB_ORG_NAME not set
if [ -z "$GITHUB_ORG_NAME" ] && [ -f ".env" ]; then
    echo "📄 Loading configuration from .env file..."
    export $(grep -v '^#' .env | grep -v '^[[:space:]]*$' | xargs)
fi

# Configuration
ORG_NAME="${GITHUB_ORG_NAME:-YourOrganization}"
TEAM_NAME="Active-Session-Users"
TEAM_SLUG="${GITHUB_GATEKEEPER_TEAM_SLUG:-active-session-users}"

echo ""

echo "🔧 Configuring GitHub Organization: $ORG_NAME"
echo "=================================================="
echo ""

# Step 1: Check current base permissions
echo "📋 Step 1: Checking current base permissions..."
CURRENT_PERM=$(gh api /orgs/$ORG_NAME --jq '.default_repository_permission' 2>/dev/null || echo "error")

if [ "$CURRENT_PERM" = "error" ]; then
    echo "❌ Error: Cannot access organization $ORG_NAME"
    echo "   Make sure you have admin access and gh CLI is authenticated"
    exit 1
fi

echo "   Current permission: $CURRENT_PERM"

# Step 2: Set base permissions to "none"
if [ "$CURRENT_PERM" != "none" ]; then
    echo ""
    echo "🔒 Step 2: Setting base permissions to 'none'..."
    gh api /orgs/$ORG_NAME \
        --method PATCH \
        --input - <<EOF
{
  "default_repository_permission": "none",
  "members_can_create_repositories": false
}
EOF

    echo "   ✅ Base permissions set to: none"
    echo "   ✅ Member repository creation: disabled"
else
    echo ""
    echo "✅ Step 2: Base permissions already set to 'none'"
fi

# Step 3: Create gatekeeper team
echo ""
echo "👥 Step 3: Creating/verifying gatekeeper team..."

# Check if team exists
TEAM_ID=$(gh api /orgs/$ORG_NAME/teams/$TEAM_SLUG --jq '.id' 2>/dev/null || echo "")

if [ -z "$TEAM_ID" ]; then
    echo "   Creating team: $TEAM_NAME"
    gh api /orgs/$ORG_NAME/teams \
        --method POST \
        --input - <<EOF
{
  "name": "$TEAM_NAME",
  "description": "Gatekeeper team for Identity Bridge - grants 24-hour repository access",
  "privacy": "closed"
}
EOF

    TEAM_ID=$(gh api /orgs/$ORG_NAME/teams/$TEAM_SLUG --jq '.id')
    echo "   ✅ Team created: $TEAM_NAME (ID: $TEAM_ID)"
else
    echo "   ✅ Team already exists: $TEAM_NAME (ID: $TEAM_ID)"
fi

# Step 4: Check 2FA requirement status
echo ""
echo "🔐 Step 4: Checking 2FA requirement..."
TWO_FA_REQUIRED=$(gh api /orgs/$ORG_NAME --jq '.two_factor_requirement_enabled' 2>/dev/null || echo "unknown")

if [ "$TWO_FA_REQUIRED" = "true" ]; then
    echo "   ✅ 2FA requirement: enabled"
elif [ "$TWO_FA_REQUIRED" = "false" ]; then
    echo "   ⚠️  2FA requirement: disabled"
    echo ""
    echo "   ⚠️  IMPORTANT: Enable 2FA manually in the portal:"
    echo "   https://github.com/organizations/$ORG_NAME/settings/security"
    echo ""
    echo "   Note: 2FA requirement cannot be enabled via API for security reasons."
    echo "         You must enable it in the GitHub organization settings."
else
    echo "   ⚠️  Cannot determine 2FA status"
fi

# Step 5: Display summary
echo ""
echo "=================================================="
echo "✅ GitHub Organization Configuration Complete"
echo "=================================================="
echo ""
echo "Organization: $ORG_NAME"
echo "Base Permissions: none"
echo "Gatekeeper Team: $TEAM_NAME ($TEAM_SLUG)"
echo "Team ID: $TEAM_ID"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Grant the '$TEAM_NAME' team access to repositories:"
echo "   For each repository you want to protect:"
echo ""
echo "   gh api /orgs/$ORG_NAME/teams/$TEAM_SLUG/repos/$ORG_NAME/{REPO_NAME} \\"
echo "     --method PUT \\"
echo "     -f permission=push"
echo ""
echo "2. Enable 2FA requirement (manual step):"
echo "   https://github.com/organizations/$ORG_NAME/settings/security"
echo "   Check: 'Require two-factor authentication for everyone'"
echo ""
echo "3. Verify settings:"
echo "   https://github.com/organizations/$ORG_NAME/settings/member_privileges"
echo ""
echo "4. Deploy the Azure Function App and set environment variables"
echo ""

# Optional: Export team ID for use in Azure config
if [ -n "$TEAM_ID" ]; then
    echo "💡 Export for Azure configuration:"
    echo "   export GITHUB_GATEKEEPER_TEAM_ID=$TEAM_ID"
    echo ""
fi
