const logger = require('../../shared/logger');
const azureAd = require('../../shared/azure-ad');
const mockOAuth = require('../../shared/mock-oauth');

/**
 * Login function - Initiates Azure AD OAuth flow
 * GET /api/Login
 */
module.exports = async function (context, req) {
  try {
    logger.initializeAppInsights(context);
    logger.info('Login endpoint called');

    // Build Azure AD OAuth URL
    let authUrl;
    if (mockOAuth.MOCK_MODE) {
      logger.info('Using mock OAuth mode');
      // In mock mode, redirect to auth callback with a mock code
      const mockCode = req.query.email
        ? `mock-${req.query.email.replace('@', '-').replace('.', '-')}`
        : 'mock-test@oregonstate.edu';
      authUrl = `${process.env.REDIRECT_URI}?code=${mockCode}&state=azure_init`;
    } else {
      authUrl = azureAd.buildAzureAdAuthUrl('azure_init');
    }

    logger.info('Redirecting to Azure AD', { url: authUrl });

    context.res = {
      status: 302,
      headers: {
        'Location': authUrl,
        'Content-Type': 'text/html'
      },
      body: `Redirecting to login... <a href="${authUrl}">Click here if not redirected</a>`
    };
  } catch (error) {
    logger.error('Login error', error);
    context.res = {
      status: 500,
      body: JSON.stringify({
        error: 'Authentication failed',
        message: error.message
      })
    };
  }
};
