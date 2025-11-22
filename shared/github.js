const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const axios = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Create GitHub App authenticated Octokit instance
 */
async function createGithubAppOctokit() {
  try {
    const appId = process.env.GITHUB_APP_ID;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !installationId || !privateKey) {
      throw new Error('Missing GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY)');
    }

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
        installationId
      }
    });

    logger.debug('GitHub App Octokit instance created');
    return octokit;
  } catch (error) {
    logger.error('Failed to create GitHub App Octokit', error);
    throw error;
  }
}

/**
 * Create GitHub OAuth authenticated Octokit instance
 */
function createGithubOAuthOctokit(accessToken) {
  try {
    const octokit = new Octokit({
      auth: accessToken
    });
    logger.debug('GitHub OAuth Octokit instance created');
    return octokit;
  } catch (error) {
    logger.error('Failed to create GitHub OAuth Octokit', error);
    throw error;
  }
}

/**
 * Exchange GitHub OAuth code for access token
 */
async function exchangeGithubCode(code) {
  try {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing GitHub OAuth credentials');
    }

    const response = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: clientId,
      client_secret: clientSecret,
      code: code
    }, {
      headers: { accept: 'application/json' }
    });

    if (response.data.error) {
      throw new Error(`GitHub OAuth error: ${response.data.error_description}`);
    }

    logger.info('GitHub OAuth code exchanged successfully');
    return response.data.access_token;
  } catch (error) {
    logger.error('Failed to exchange GitHub code', error);
    throw error;
  }
}

/**
 * Get authenticated GitHub user info
 */
async function getAuthenticatedUser(accessToken) {
  try {
    const octokit = createGithubOAuthOctokit(accessToken);
    const { data } = await octokit.rest.users.getAuthenticated();

    logger.info(`Retrieved GitHub user: ${data.login}`);
    return data;
  } catch (error) {
    logger.error('Failed to get authenticated user', error);
    throw error;
  }
}

/**
 * Add user to organization
 */
async function addUserToOrg(username, org = null) {
  try {
    const orgName = org || process.env.GITHUB_ORG_NAME;
    if (!orgName) {
      throw new Error('Organization name not provided');
    }

    const octokit = await createGithubAppOctokit();
    await octokit.rest.orgs.setMembershipForUser({
      org: orgName,
      username: username,
      role: 'member'
    });

    logger.info(`User added to org: ${username} -> ${orgName}`);
  } catch (error) {
    logger.error(`Failed to add user to org: ${username}`, error);
    throw error;
  }
}

/**
 * Add user to team
 */
async function addUserToTeam(username, teamSlug, org = null) {
  try {
    const orgName = org || process.env.GITHUB_ORG_NAME;
    if (!orgName) {
      throw new Error('Organization name not provided');
    }

    const octokit = await createGithubAppOctokit();
    await octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
      org: orgName,
      team_slug: teamSlug,
      username: username
    });

    logger.info(`User added to team: ${username} -> ${orgName}/${teamSlug}`);
  } catch (error) {
    logger.error(`Failed to add user to team: ${username}/${teamSlug}`, error);
    throw error;
  }
}

/**
 * Remove user from team
 */
async function removeUserFromTeam(username, teamSlug, org = null) {
  try {
    const orgName = org || process.env.GITHUB_ORG_NAME;
    if (!orgName) {
      throw new Error('Organization name not provided');
    }

    const octokit = await createGithubAppOctokit();
    await octokit.rest.teams.removeMembershipForUserInOrg({
      org: orgName,
      team_slug: teamSlug,
      username: username
    });

    logger.info(`User removed from team: ${username} <- ${orgName}/${teamSlug}`);
  } catch (error) {
    logger.error(`Failed to remove user from team: ${username}/${teamSlug}`, error);
    throw error;
  }
}

/**
 * Remove user from organization
 */
async function removeUserFromOrg(username, org = null) {
  try {
    const orgName = org || process.env.GITHUB_ORG_NAME;
    if (!orgName) {
      throw new Error('Organization name not provided');
    }

    const octokit = await createGithubAppOctokit();
    await octokit.rest.orgs.removeMembershipForUser({
      org: orgName,
      username: username
    });

    logger.info(`User removed from org: ${username} <- ${orgName}`);
  } catch (error) {
    logger.error(`Failed to remove user from org: ${username}`, error);
    throw error;
  }
}

/**
 * Check if user is member of team
 */
async function isUserInTeam(username, teamSlug, org = null) {
  try {
    const orgName = org || process.env.GITHUB_ORG_NAME;
    if (!orgName) {
      throw new Error('Organization name not provided');
    }

    const octokit = await createGithubAppOctokit();
    try {
      const { data } = await octokit.rest.teams.getMembershipForUserInOrg({
        org: orgName,
        team_slug: teamSlug,
        username: username
      });
      return data.state === 'active';
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to check team membership: ${username}/${teamSlug}`, error);
    throw error;
  }
}

/**
 * Validate GitHub webhook signature (HMAC-SHA256)
 */
function validateWebhookSignature(payload, signature) {
  try {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) {
      logger.warning('GITHUB_APP_WEBHOOK_SECRET not set, skipping webhook validation');
      return true;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = 'sha256=' + hmac.digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warning('Invalid webhook signature');
    }

    return isValid;
  } catch (error) {
    logger.error('Webhook signature validation failed', error);
    return false;
  }
}

module.exports = {
  createGithubAppOctokit,
  createGithubOAuthOctokit,
  exchangeGithubCode,
  getAuthenticatedUser,
  addUserToOrg,
  addUserToTeam,
  removeUserFromTeam,
  removeUserFromOrg,
  isUserInTeam,
  validateWebhookSignature
};
