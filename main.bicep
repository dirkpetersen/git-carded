param location string = 'westus2'
param orgName string = 'oregonstate-ai'
param environmentType string = 'dev'
param appInsightsRetentionDays int = 30

var resourcePrefix = 'github-identity-bridge'
var resourceGroupName = '${resourcePrefix}-rg'
var storageAccountName = '${replace(resourcePrefix, '-', '')}storage${uniqueString(resourceGroup().id)}'
var functionAppName = '${resourcePrefix}-app-${uniqueString(resourceGroup().id)}'
var appServicePlanName = '${resourcePrefix}-plan'
var appInsightsName = '${resourcePrefix}-insights'
var tableName = 'UserMappings'

// Storage Account for Table Storage and Function App storage
resource storageAccount 'Microsoft.Storage/storageAccounts@2021-06-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
  }

  // User Mappings Table
  resource tableServices 'tableServices' = {
    name: 'default'
    resource userMappingsTable 'tables' = {
      name: tableName
    }
    resource sessionsTable 'tables' = {
      name: 'Sessions'
    }
    resource auditLogsTable 'tables' = {
      name: 'AuditLogs'
    }
  }
}

// Application Insights for logging and monitoring
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    RetentionInDays: appInsightsRetentionDays
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// App Service Plan (Consumption) for Functions
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: appServicePlanName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

// Function App
resource functionApp 'Microsoft.Web/sites@2022-03-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=core.windows.net'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'NODE_ENV'
          value: environmentType
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATION_KEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: 'InstrumentationKey=${appInsights.properties.InstrumentationKey}'
        }
        {
          name: 'GITHUB_ORG_NAME'
          value: orgName
        }
        {
          name: 'GITHUB_GATEKEEPER_TEAM_SLUG'
          value: 'active-session-users'
        }
      ]
      nodeVersion: '18.x'
      linuxFxVersion: 'NODE|18'
      http20Enabled: true
      minTlsVersion: '1.2'
    }
    httpsOnly: true
  }
}

// Role Assignment: Storage Table Data Contributor for Function App
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, functionApp.id, 'Storage Table Data Contributor')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0ce9bcf8b64d') // Storage Table Data Contributor
    principalId: functionApp.identity.principalId
  }
}

// Outputs
output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
output appInsightsKey string = appInsights.properties.InstrumentationKey
output appInsightsName string = appInsights.name
