#!/bin/bash

###############################################################################
# Local Development Setup Script
# Installs Azure Functions Core Tools and other prerequisites
###############################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Local Development Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "\n${YELLOW}Detected Linux${NC}"

    # Check if running on Ubuntu/Debian
    if command -v apt-get &> /dev/null; then
        echo "Installing Azure Functions Core Tools..."

        # Install prerequisites
        sudo apt-get update
        sudo apt-get install -y curl apt-transport-https

        # Add Microsoft package repository
        curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
        sudo mv microsoft.gpg /etc/apt/trusted.gpg.d/microsoft.gpg

        # Add repository
        sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/microsoft-ubuntu-$(lsb_release -cs)-prod $(lsb_release -cs) main" > /etc/apt/sources.list.d/dotnetdev.list'

        # Install Azure Functions Core Tools
        sudo apt-get update
        sudo apt-get install -y azure-functions-core-tools-4

        echo -e "${GREEN}✓ Azure Functions Core Tools installed${NC}"
    else
        echo -e "${RED}Unsupported Linux distribution. Please install manually:${NC}"
        echo "https://docs.microsoft.com/azure/azure-functions/functions-run-local"
        exit 1
    fi

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "\n${YELLOW}Detected macOS${NC}"

    if command -v brew &> /dev/null; then
        echo "Installing Azure Functions Core Tools via Homebrew..."
        brew tap azure/functions
        brew install azure-functions-core-tools@4
        echo -e "${GREEN}✓ Azure Functions Core Tools installed${NC}"
    else
        echo -e "${RED}Homebrew not found. Install from: https://brew.sh${NC}"
        exit 1
    fi
else
    echo -e "${RED}Unsupported OS: $OSTYPE${NC}"
    echo "Please install manually: https://docs.microsoft.com/azure/azure-functions/functions-run-local"
    exit 1
fi

# Verify installation
echo -e "\n${YELLOW}Verifying installation...${NC}"
func --version

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Copy configuration: cp local.settings.json.example local.settings.json"
echo "2. Install npm dependencies: npm install"
echo "3. Start local development: npm start"
echo "4. Test: curl http://localhost:7071/api/HealthCheck"
