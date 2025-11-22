#!/bin/bash

###############################################################################
# GitHub Identity Bridge - Automated Deployment Script
# Orchestrates full deployment to Azure
###############################################################################

set -e  # Exit on error

# Configuration
RESOURCE_GROUP="github-identity-bridge-rg"
LOCATION="westus2"
STORAGE_ACCOUNT="githubidentitybridge"
FUNCTION_APP="github-identity-bridge-app"
ORG_NAME="oregonstate-ai"
TEAM_NAME="Active-Session-Users"
BICEP_FILE="main.bicep"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}GitHub Identity Bridge - Deployment${NC}"
echo -e "${GREEN}========================================${NC}"

# Phase 1: Verify Prerequisites
echo -e "\n${YELLOW}Phase 1: Verifying Prerequisites${NC}"

if ! command -v az &> /dev/null; then
    echo -e "${RED}Error: Azure CLI not installed${NC}"
    exit 1
fi

if ! command -v func &> /dev/null; then
    echo -e "${RED}Error: Azure Functions Core Tools not installed${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm not installed${NC}"
    exit 1
fi

if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites installed${NC}"

# Phase 2: Authenticate
echo -e "\n${YELLOW}Phase 2: Verifying Authentication${NC}"

if ! az account show &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with Azure${NC}"
    echo "Run: az login"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not authenticated with GitHub${NC}"
    echo "Run: gh auth login"
    exit 1
fi

echo -e "${GREEN}✓ Azure and GitHub authentication verified${NC}"

# Phase 3: Create Resource Group
echo -e "\n${YELLOW}Phase 3: Creating Resource Group${NC}"

if az group exists --name "$RESOURCE_GROUP" --query "value" -o tsv | grep -q true; then
    echo -e "${GREEN}✓ Resource group already exists: $RESOURCE_GROUP${NC}"
else
    echo "Creating resource group: $RESOURCE_GROUP"
    az group create \
        --name "$RESOURCE_GROUP" \
        --location "$LOCATION"
    echo -e "${GREEN}✓ Resource group created${NC}"
fi

# Phase 4: Deploy Bicep Template
echo -e "\n${YELLOW}Phase 4: Deploying Azure Infrastructure (Bicep)${NC}"

if [ ! -f "$BICEP_FILE" ]; then
    echo -e "${RED}Error: Bicep file not found: $BICEP_FILE${NC}"
    exit 1
fi

echo "Deploying Bicep template..."
az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file "$BICEP_FILE" \
    --parameters \
        location="$LOCATION" \
        orgName="$ORG_NAME" \
        environmentType="dev"

echo -e "${GREEN}✓ Azure infrastructure deployed${NC}"

# Phase 5: Install NPM Dependencies
echo -e "\n${YELLOW}Phase 5: Installing Node.js Dependencies${NC}"

if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found${NC}"
    exit 1
fi

echo "Running npm install..."
npm install

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Phase 6: Deploy Function Code
echo -e "\n${YELLOW}Phase 6: Deploying Function App Code${NC}"

echo "Publishing to Function App: $FUNCTION_APP"
func azure functionapp publish "$FUNCTION_APP" --build remote

echo -e "${GREEN}✓ Function App deployed${NC}"

# Phase 7: Create GitHub Team
echo -e "\n${YELLOW}Phase 7: Creating GitHub Gatekeeper Team${NC}"

TEAM_CHECK=$(gh api "/orgs/$ORG_NAME/teams" --jq ".[] | select(.name==\"$TEAM_NAME\") | .slug" 2>/dev/null || echo "")

if [ -z "$TEAM_CHECK" ]; then
    echo "Creating team: $TEAM_NAME"
    gh api "/orgs/$ORG_NAME/teams" \
        -f name="$TEAM_NAME" \
        -f description="Gatekeeper team for GitHub Identity Bridge access" \
        -f privacy="closed"
    echo -e "${GREEN}✓ Team created: $TEAM_NAME${NC}"
else
    echo -e "${GREEN}✓ Team already exists: $TEAM_NAME${NC}"
fi

# Phase 8: Configure Function App Settings (Prompt for secrets)
echo -e "\n${YELLOW}Phase 8: Configuring Secrets${NC}"

echo -e "${YELLOW}You need to configure the following secrets:${NC}"
echo "1. AZURE_TENANT_ID"
echo "2. AZURE_CLIENT_ID"
echo "3. AZURE_CLIENT_SECRET"
echo "4. GITHUB_OAUTH_CLIENT_ID"
echo "5. GITHUB_OAUTH_CLIENT_SECRET"
echo "6. GITHUB_APP_ID"
echo "7. GITHUB_APP_INSTALLATION_ID"
echo "8. GITHUB_APP_PRIVATE_KEY"
echo "9. GITHUB_APP_WEBHOOK_SECRET"

read -p "Would you like to set secrets now? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Use Azure Portal to set these values:"
    echo "Go to: Function App > Settings > Configuration > Application settings"
    echo "https://portal.azure.com/"
else
    echo -e "${YELLOW}Reminder: You must set the secrets before the deployment can function properly${NC}"
fi

# Phase 9: Summary
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo "1. Set secrets in Function App configuration:"
echo "   https://portal.azure.com/#@/resource/subscriptions/*/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNCTION_APP"
echo ""
echo "2. Configure GitHub Organization Settings:"
echo "   - Set Base Permissions to 'None'"
echo "   - Enable 2FA requirement"
echo ""
echo "3. Update GitHub App webhook URL to:"
echo "   https://$FUNCTION_APP.azurewebsites.net/api/GithubWebhook"
echo ""
echo "4. Test the portal:"
echo "   https://$FUNCTION_APP.azurewebsites.net/api/Login"
echo ""
echo -e "${YELLOW}Need help?${NC} See docs/TESTING.md"
