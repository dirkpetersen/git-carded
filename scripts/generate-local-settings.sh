#!/bin/bash
# Generate local.settings.json from .env file
# Usage: ./scripts/generate-local-settings.sh [path-to-env-file]
#
# This script converts a .env file to the local.settings.json format
# required by Azure Functions Core Tools for local development.

set -e

# Default to .env in current directory
ENV_FILE="${1:-.env}"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: $ENV_FILE not found"
    echo ""
    echo "Usage:"
    echo "  1. Copy .env.default to .env:"
    echo "     cp .env.default .env"
    echo ""
    echo "  2. Fill in your values in .env"
    echo ""
    echo "  3. Run this script:"
    echo "     ./scripts/generate-local-settings.sh"
    echo ""
    exit 1
fi

echo "📝 Generating local.settings.json from $ENV_FILE..."

# Start building the JSON
cat > local.settings.json << 'EOF_START'
{
  "IsEncrypted": false,
  "Values": {
EOF_START

# Read .env file and convert to JSON format
first_line=true
while IFS='=' read -r key value; do
    # Skip empty lines and comments
    if [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]]; then
        continue
    fi

    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)

    # Remove quotes from value if present
    value="${value%\"}"
    value="${value#\"}"

    # Skip if key is empty
    if [ -z "$key" ]; then
        continue
    fi

    # Add comma before all entries except the first
    if [ "$first_line" = true ]; then
        first_line=false
    else
        echo "," >> local.settings.json
    fi

    # Escape special characters in value for JSON
    value=$(echo "$value" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')

    # Add the key-value pair
    echo -n "    \"$key\": \"$value\"" >> local.settings.json

done < <(grep -v '^[[:space:]]*$' "$ENV_FILE" | grep -v '^[[:space:]]*#')

# Add required Azure Functions settings if not present
if ! grep -q "FUNCTIONS_WORKER_RUNTIME" "$ENV_FILE"; then
    echo "," >> local.settings.json
    echo -n "    \"FUNCTIONS_WORKER_RUNTIME\": \"node\"" >> local.settings.json
fi

if ! grep -q "AzureWebJobsStorage" "$ENV_FILE"; then
    echo "," >> local.settings.json
    echo -n "    \"AzureWebJobsStorage\": \"UseDevelopmentStorage=true\"" >> local.settings.json
fi

# Close the JSON
cat >> local.settings.json << 'EOF_END'

  },
  "Host": {
    "LocalHttpPort": 7071,
    "CORS": "*"
  }
}
EOF_END

echo "✅ local.settings.json generated successfully"
echo ""
echo "You can now run locally with:"
echo "  func start"
echo ""
echo "Or use the development server:"
echo "  node local-server.js"
