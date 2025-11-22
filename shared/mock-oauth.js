/**
 * Mock OAuth for local testing without real Azure AD/GitHub credentials
 */

const logger = require('./logger');

const MOCK_MODE = process.env.USE_MOCK_OAUTH === 'true';

/**
 * Mock Azure AD token (for testing without real Azure credentials)
 */
function createMockAzureAdToken(email = 'test@oregonstate.edu') {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    iss: 'https://login.microsoftonline.com/mock-tenant-id/v2.0',
    sub: 'mock-subject-id',
    aud: 'mock-client-id',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: email,
    email_verified: true,
    name: 'Test User',
    preferred_username: email,
    oid: 'mock-object-id'
  };

  // Simple base64 encoding (not cryptographically valid, but good enough for testing)
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'mock-signature';

  const mockToken = `${encodedHeader}.${encodedPayload}.${signature}`;
  logger.debug(`Created mock Azure AD token for ${email}`);
  return mockToken;
}

/**
 * Mock GitHub access token
 */
function createMockGithubAccessToken() {
  return 'ghu_mock_github_token_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Mock GitHub user object
 */
function createMockGithubUser(username = 'testuser') {
  return {
    login: username,
    id: Math.floor(Math.random() * 1000000),
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    name: 'Test User',
    company: null,
    blog: '',
    location: '',
    email: `${username}@oregonstate.edu`,
    bio: null,
    public_repos: 5,
    public_gists: 0,
    followers: 10,
    following: 20
  };
}

/**
 * Intercept Azure AD OAuth (for mock mode)
 */
async function mockExchangeAzureAdCode(code) {
  if (!MOCK_MODE) {
    throw new Error('Mock OAuth only available in USE_MOCK_OAUTH=true mode');
  }

  logger.info('Using mock Azure AD token exchange');

  // Extract email from code if present (format: "mock-email@example.com")
  const email = code.startsWith('mock-')
    ? code.replace('mock-', '')
    : 'test@oregonstate.edu';

  const idToken = createMockAzureAdToken(email);

  return {
    accessToken: 'mock-azure-access-token',
    idToken: idToken,
    refreshToken: 'mock-refresh-token'
  };
}

/**
 * Intercept GitHub OAuth (for mock mode)
 */
async function mockExchangeGithubCode(code) {
  if (!MOCK_MODE) {
    throw new Error('Mock OAuth only available in USE_MOCK_OAUTH=true mode');
  }

  logger.info('Using mock GitHub token exchange');

  // Extract username from code if present (format: "mock-testuser")
  const username = code.startsWith('mock-')
    ? code.replace('mock-', '')
    : 'testuser';

  return createMockGithubAccessToken();
}

/**
 * Mock get authenticated GitHub user
 */
function mockGetAuthenticatedUser(accessToken) {
  if (!MOCK_MODE) {
    throw new Error('Mock OAuth only available in USE_MOCK_OAUTH=true mode');
  }

  logger.info('Using mock GitHub user retrieval');

  // Extract username from token if present
  const username = accessToken.includes('testuser')
    ? 'testuser'
    : 'testuser';

  return createMockGithubUser(username);
}

/**
 * Mock check user active in AD
 */
async function mockCheckUserActiveInAd(userEmail) {
  if (!MOCK_MODE) {
    throw new Error('Mock OAuth only available in USE_MOCK_OAUTH=true mode');
  }

  logger.info(`Mock Azure AD user check: ${userEmail}`);

  // In mock mode, all users are active unless email contains "disabled"
  const isActive = !userEmail.includes('disabled');

  return {
    isActive,
    displayName: 'Test User',
    mail: userEmail,
    userPrincipalName: userEmail
  };
}

module.exports = {
  MOCK_MODE,
  createMockAzureAdToken,
  createMockGithubAccessToken,
  createMockGithubUser,
  mockExchangeAzureAdCode,
  mockExchangeGithubCode,
  mockGetAuthenticatedUser,
  mockCheckUserActiveInAd
};
