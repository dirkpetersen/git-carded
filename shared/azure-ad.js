const axios = require('axios');
const querystring = require('querystring');
const { jwtDecode } = require('jwt-decode');
const logger = require('./logger');

/**
 * Build Azure AD OAuth authorization URL
 */
function buildAzureAdAuthUrl(state = 'azure_init') {
  try {
    const params = {
      client_id: process.env.AZURE_CLIENT_ID,
      response_type: 'code',
      redirect_uri: process.env.REDIRECT_URI,
      response_mode: 'query',
      scope: 'openid profile email',
      state: state
    };

    const tenantId = process.env.AZURE_TENANT_ID;
    if (!tenantId) {
      throw new Error('AZURE_TENANT_ID not set');
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${querystring.stringify(params)}`;
    logger.debug('Azure AD auth URL built');
    return url;
  } catch (error) {
    logger.error('Failed to build Azure AD auth URL', error);
    throw error;
  }
}

/**
 * Exchange Azure AD code for tokens
 */
async function exchangeAzureAdCode(code) {
  try {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const redirectUri = process.env.REDIRECT_URI;

    if (!tenantId || !clientId || !clientSecret || !redirectUri) {
      throw new Error('Missing Azure AD configuration');
    }

    const response = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      querystring.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    if (response.data.error) {
      throw new Error(`Azure AD error: ${response.data.error_description}`);
    }

    logger.info('Azure AD code exchanged successfully');
    return {
      accessToken: response.data.access_token,
      idToken: response.data.id_token,
      refreshToken: response.data.refresh_token
    };
  } catch (error) {
    logger.error('Failed to exchange Azure AD code', error);
    throw error;
  }
}

/**
 * Get user info from Azure AD (no validation - token already validated by Azure)
 */
function getUserInfoFromToken(idToken) {
  try {
    if (!idToken) {
      throw new Error('No ID token provided');
    }

    // Decode without validation (Azure already validated it)
    const decoded = jwtDecode(idToken);

    const userInfo = {
      email: decoded.email || decoded.preferred_username,
      name: decoded.name,
      upn: decoded.upn,
      oid: decoded.oid // Object ID for future use
    };

    logger.info(`User info extracted from token: ${userInfo.email}`);
    return userInfo;
  } catch (error) {
    logger.error('Failed to extract user info from token', error);
    throw error;
  }
}

/**
 * Query Azure AD via Microsoft Graph to check if user is active
 */
async function checkUserActiveInAd(userEmail) {
  try {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Missing Azure AD configuration for Graph API');
    }

    // Get access token for Graph API
    const tokenResponse = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      querystring.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const graphToken = tokenResponse.data.access_token;

    // Query user from Graph API
    const userResponse = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${userEmail}`,
      {
        headers: { Authorization: `Bearer ${graphToken}` }
      }
    );

    const isActive = userResponse.data.accountEnabled;
    logger.info(`User ${userEmail} active status: ${isActive}`);

    return {
      isActive,
      displayName: userResponse.data.displayName,
      mail: userResponse.data.mail,
      userPrincipalName: userResponse.data.userPrincipalName
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logger.warning(`User not found in Azure AD: ${userEmail}`);
      return { isActive: false };
    }
    logger.error(`Failed to check user in Azure AD: ${userEmail}`, error);
    throw error;
  }
}

module.exports = {
  buildAzureAdAuthUrl,
  exchangeAzureAdCode,
  getUserInfoFromToken,
  checkUserActiveInAd
};
