#!/bin/bash

###############################################################################
# GitHub Identity Bridge - Cleanup Script
# Removes all deployed resources
###############################################################################

set -e

RESOURCE_GROUP="github-identity-bridge-rg"
ORG_NAME="oregonstate-ai"
TEAM_NAME="Active-Session-Users"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}========================================${NC}"
echo -e "${RED}GitHub Identity Bridge - Cleanup${NC}"
echo -e "${RED}========================================${NC}"

echo -e "\n${YELLOW}WARNING: This will delete all resources!${NC}"
echo "Resource Group: $RESOURCE_GROUP"
echo "GitHub Team will also be removed (optional)"

read -p "Are you sure you want to continue? (type 'yes' to confirm) " -r
echo

if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Cleanup cancelled"
    exit 0
fi

# Phase 1: Delete Azure Resource Group
echo -e "\n${YELLOW}Phase 1: Deleting Azure Resource Group${NC}"

if az group exists --name "$RESOURCE_GROUP" --query "value" -o tsv | grep -q true; then
    echo "Deleting resource group: $RESOURCE_GROUP"
    az group delete \
        --name "$RESOURCE_GROUP" \
        --yes \
        --no-wait
    echo -e "${GREEN}✓ Resource group deletion initiated (this may take several minutes)${NC}"
else
    echo -e "${YELLOW}Resource group not found: $RESOURCE_GROUP${NC}"
fi

# Phase 2: Delete GitHub Team (optional)
echo -e "\n${YELLOW}Phase 2: Cleaning up GitHub Team${NC}"

read -p "Delete GitHub team '$TEAM_NAME'? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    TEAM_SLUG=$(gh api "/orgs/$ORG_NAME/teams" --jq ".[] | select(.name==\"$TEAM_NAME\") | .slug" 2>/dev/null || echo "")

    if [ -n "$TEAM_SLUG" ]; then
        echo "Deleting team: $TEAM_NAME ($TEAM_SLUG)"
        gh api -X DELETE "/orgs/$ORG_NAME/teams/$TEAM_SLUG"
        echo -e "${GREEN}✓ Team deleted${NC}"
    else
        echo -e "${YELLOW}Team not found: $TEAM_NAME${NC}"
    fi
else
    echo "Skipping team deletion"
fi

# Phase 3: Remove GitHub App (informational)
echo -e "\n${YELLOW}Phase 3: GitHub App${NC}"
echo "The GitHub App should be manually uninstalled from:"
echo "https://github.com/organizations/$ORG_NAME/settings/apps"

# Summary
echo -e "\n${RED}========================================${NC}"
echo -e "${RED}Cleanup Initiated!${NC}"
echo -e "${RED}========================================${NC}"

echo -e "\n${YELLOW}Remaining Manual Steps:${NC}"
echo "1. Uninstall the GitHub App from the organization:"
echo "   https://github.com/organizations/$ORG_NAME/settings/apps"
echo ""
echo "2. Check deletion status of Resource Group:"
echo "   az group exists --name $RESOURCE_GROUP"
echo ""
echo "3. Verify all resources are deleted:"
echo "   az resource list --resource-group $RESOURCE_GROUP"
