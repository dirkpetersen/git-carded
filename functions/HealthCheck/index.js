const logger = require('../../shared/logger');
const database = require('../../shared/database');

/**
 * HealthCheck function - Verifies system connectivity
 * GET /api/HealthCheck
 */
module.exports = async function (context, req) {
  try {
    logger.initializeAppInsights(context);
    logger.info('HealthCheck endpoint called');

    const checks = {
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        USE_MOCK_OAUTH: process.env.USE_MOCK_OAUTH === 'true',
        GITHUB_ORG_NAME: process.env.GITHUB_ORG_NAME
      },
      credentials: {
        azureAdConfigured: !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET),
        githubOAuthConfigured: !!(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET),
        githubAppConfigured: !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY),
        storageConfigured: !!process.env.AzureWebJobsStorage
      },
      services: {
        database: 'checking...',
        appInsights: !!process.env.APPINSIGHTS_INSTRUMENTATION_KEY
      }
    };

    // Test database connectivity
    try {
      await database.initializeDatabase();
      checks.services.database = 'connected';
    } catch (error) {
      checks.services.database = `error: ${error.message}`;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checks, null, 2)
    };

    logger.info('HealthCheck completed', checks);
  } catch (error) {
    logger.error('HealthCheck error', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Health check failed',
        message: error.message
      })
    };
  }
};
