const logger = require('../../shared/logger');
const azureAd = require('../../shared/azure-ad');
const github = require('../../shared/github');
const database = require('../../shared/database');
const mockOAuth = require('../../shared/mock-oauth');
const querystring = require('querystring');

/**
 * AuthCallback function - Handles both Azure AD and GitHub OAuth callbacks
 * GET /api/AuthCallback?code=...&state=...
 */
module.exports = async function (context, req) {
  try {
    logger.initializeAppInsights(context);
    logger.info('AuthCallback endpoint called', { state: req.query.state });

    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
      throw new Error('Missing code or state parameter');
    }

    // Initialize database (skip if in mock mode without storage)
    if (!mockOAuth.MOCK_MODE || process.env.AzureWebJobsStorage !== 'UseDevelopmentStorage=true') {
      try {
        await database.initializeDatabase();
      } catch (error) {
        if (mockOAuth.MOCK_MODE) {
          logger.warning('Database unavailable in mock mode, continuing without storage');
        } else {
          throw error;
        }
      }
    }

    // === STAGE 1: RETURNING FROM AZURE AD ===
    if (state === 'azure_init') {
      logger.info('Processing Azure AD callback');

      // Exchange code for tokens
      let tokens;
      if (mockOAuth.MOCK_MODE) {
        tokens = await mockOAuth.mockExchangeAzureAdCode(code);
      } else {
        tokens = await azureAd.exchangeAzureAdCode(code);
      }

      // Extract user info from ID token
      const userInfo = azureAd.getUserInfoFromToken(tokens.idToken);
      const userEmail = userInfo.email;

      logger.info(`Azure AD user authenticated: ${userEmail}`);

      // Check if user already linked (in mock mode, always treat as new user)
      let existingMapping = null;
      if (!mockOAuth.MOCK_MODE) {
        try {
          existingMapping = await database.getUserMapping(userEmail);
        } catch (error) {
          logger.warning('Database query failed, treating as new user', error);
        }
      }

      if (existingMapping) {
        // User already linked - just update last login
        logger.info(`User already linked: ${userEmail} -> ${existingMapping.GitHubUsername}`);
        await database.updateLastLogin(userEmail);

        // Ensure they're still in the gatekeeper team
        try {
          const teamSlug = process.env.GITHUB_GATEKEEPER_TEAM_SLUG || 'active-session-users';
          await github.addUserToTeam(existingMapping.GitHubUsername, teamSlug);
        } catch (error) {
          logger.warning(`Failed to ensure user in team: ${existingMapping.GitHubUsername}`, error);
        }

        // Log audit event
        await database.logAuditEvent('USER_REAUTHENTICATED', {
          email: userEmail,
          githubUsername: existingMapping.GitHubUsername
        });

        // Return success page
        context.res = {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          body: `
            <html>
              <head><title>Authentication Successful</title></head>
              <body>
                <h1>Welcome back, ${existingMapping.GitHubUsername}!</h1>
                <p>You have been re-authenticated and your access has been restored.</p>
                <p><a href="https://github.com/oregonstate-ai">Go to GitHub Organization</a></p>
              </body>
            </html>
          `
        };
      } else {
        // New user - redirect to GitHub OAuth to link account
        logger.info(`New user, redirecting to GitHub OAuth: ${userEmail}`);

        const githubAuthUrl = buildGithubOAuthUrl(`github_init|${userEmail}`);

        context.res = {
          status: 302,
          headers: {
            'Location': githubAuthUrl,
            'Content-Type': 'text/html'
          },
          body: `Redirecting to GitHub... <a href="${githubAuthUrl}">Click here if not redirected</a>`
        };
      }
    }
    // === STAGE 2: RETURNING FROM GITHUB ===
    else if (state && state.startsWith('github_init')) {
      logger.info('Processing GitHub OAuth callback');

      const userEmail = state.split('|')[1];

      if (!userEmail) {
        throw new Error('User email not found in state');
      }

      // Exchange code for GitHub access token
      let accessToken;
      if (mockOAuth.MOCK_MODE) {
        accessToken = await mockOAuth.mockExchangeGithubCode(code);
      } else {
        accessToken = await github.exchangeGithubCode(code);
      }

      // Get GitHub user info
      let ghUser;
      if (mockOAuth.MOCK_MODE) {
        ghUser = mockOAuth.mockGetAuthenticatedUser(accessToken);
      } else {
        ghUser = await github.getAuthenticatedUser(accessToken);
      }

      logger.info(`GitHub user authenticated: ${ghUser.login}`);

      // Store mapping in database (skip in mock mode if database unavailable)
      if (!mockOAuth.MOCK_MODE) {
        try {
          await database.upsertUserMapping(userEmail, ghUser.login);
          await database.logAuditEvent('USER_LINKED', {
            email: userEmail,
            githubUsername: ghUser.login
          });
        } catch (error) {
          logger.warning('Failed to store mapping in database', error);
        }
      }

      // Add user to organization (skip in mock mode)
      if (!mockOAuth.MOCK_MODE) {
        try {
          await github.addUserToOrg(ghUser.login);
        } catch (error) {
          logger.warning(`Failed to add user to org: ${ghUser.login}`, error);
        }

        // Add user to gatekeeper team
        try {
          const teamSlug = process.env.GITHUB_GATEKEEPER_TEAM_SLUG || 'active-session-users';
          await github.addUserToTeam(ghUser.login, teamSlug);
        } catch (error) {
          logger.warning(`Failed to add user to team: ${ghUser.login}`, error);
        }
      }

      logger.info(`User linked successfully: ${userEmail} <-> ${ghUser.login}`);

      // Return success page
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html>
            <head><title>Account Linked Successfully</title></head>
            <body>
              <h1>Success!</h1>
              <p>Your account has been successfully linked.</p>
              <p><strong>Azure Email:</strong> ${userEmail}</p>
              <p><strong>GitHub Username:</strong> ${ghUser.login}</p>
              <p>You have been added to the ${process.env.GITHUB_ORG_NAME || 'oregonstate-ai'} organization.</p>
              <p><a href="https://github.com/oregonstate-ai">Go to GitHub Organization</a></p>
            </body>
          </html>
        `
      };
    } else {
      throw new Error(`Unknown state parameter: ${state}`);
    }
  } catch (error) {
    logger.error('AuthCallback error', error);
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <html>
          <head><title>Authentication Error</title></head>
          <body>
            <h1>Authentication Failed</h1>
            <p>${error.message}</p>
            <p><a href="/api/Login">Try again</a></p>
          </body>
        </html>
      `
    };
  }
};

/**
 * Build GitHub OAuth URL
 */
function buildGithubOAuthUrl(state) {
  const params = {
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    state: state,
    scope: 'read:user'
  };

  return `https://github.com/login/oauth/authorize?${querystring.stringify(params)}`;
}
