const logger = require('../shared/logger');
const database = require('../shared/database');
const github = require('../shared/github');
const azureAd = require('../shared/azure-ad');
const mockOAuth = require('../shared/mock-oauth');

const MAX_LEASE_HOURS = 24; // Expire after 24 hours
const GATEKEEPER_TEAM_SLUG = process.env.GITHUB_GATEKEEPER_TEAM_SLUG || 'active-session-users';

/**
 * Audit function - Timer trigger (every 15 minutes)
 * Enforces lease expiration (Soft Lock) and detects terminated users (Hard Kick)
 */
module.exports = async function (context, myTimer) {
  try {
    logger.initializeAppInsights(context);
    logger.info('Audit function triggered');

    // Initialize database
    await database.initializeDatabase();

    // Get all users from database
    const users = await database.getAllUserMappings();
    logger.info(`Found ${users.length} users to audit`);

    const now = new Date();
    let softLocksCount = 0;
    let hardKicksCount = 0;
    let activeUsersCount = 0;

    // Process each user
    for (const user of users) {
      const email = user.rowKey;
      const githubUsername = user.GitHubUsername;

      logger.info(`Auditing user: ${email} (${githubUsername})`);

      try {
        // CHECK 1: Is the AD Account Disabled? (HARD KICK)
        let adStatus;
        if (mockOAuth.MOCK_MODE) {
          adStatus = await mockOAuth.mockCheckUserActiveInAd(email);
        } else {
          adStatus = await azureAd.checkUserActiveInAd(email);
        }

        if (!adStatus.isActive) {
          logger.warning(`User account disabled in AD: ${email}. Performing HARD KICK.`);

          // Remove from organization entirely
          await github.removeUserFromOrg(githubUsername);

          // Delete from database
          await database.deleteUserMapping(email);

          // Log audit event
          await database.logAuditEvent('USER_HARD_KICKED', {
            email: email,
            githubUsername: githubUsername,
            reason: 'AD account disabled'
          });

          hardKicksCount++;
          continue;
        }

        // CHECK 2: Has the "Lease" Expired? (SOFT LOCK)
        const lastLogin = new Date(user.Timestamp || user.LastLoginTimestamp);
        const hoursSinceLogin = (now - lastLogin) / (1000 * 60 * 60);

        if (hoursSinceLogin > MAX_LEASE_HOURS) {
          logger.warning(`User lease expired: ${email} (${hoursSinceLogin.toFixed(1)}h since login). Performing SOFT LOCK.`);

          // Remove from gatekeeper team only
          await github.removeUserFromTeam(githubUsername, GATEKEEPER_TEAM_SLUG);

          // Log audit event
          await database.logAuditEvent('USER_SOFT_LOCKED', {
            email: email,
            githubUsername: githubUsername,
            hoursSinceLogin: hoursSinceLogin.toFixed(1)
          });

          softLocksCount++;
        } else {
          // CHECK 3: Active Lease - Self-healing (ensure in team if valid)
          logger.info(`User has active lease: ${email} (${hoursSinceLogin.toFixed(1)}h since login)`);

          try {
            await github.addUserToTeam(githubUsername, GATEKEEPER_TEAM_SLUG);
          } catch (error) {
            logger.warning(`Failed to ensure user in team: ${githubUsername}`, error);
          }

          activeUsersCount++;
        }
      } catch (error) {
        logger.error(`Failed to audit user ${email}`, error);

        // If user not found in AD (404), treat as termination
        if (error.response && error.response.status === 404) {
          logger.warning(`User not found in AD: ${email}. Performing HARD KICK.`);
          try {
            await github.removeUserFromOrg(githubUsername);
            await database.deleteUserMapping(email);
            hardKicksCount++;
          } catch (cleanupError) {
            logger.error(`Failed to clean up removed user: ${email}`, cleanupError);
          }
        }
      }
    }

    const summary = {
      totalUsers: users.length,
      activeUsers: activeUsersCount,
      softLocks: softLocksCount,
      hardKicks: hardKicksCount,
      timestamp: now.toISOString()
    };

    logger.info('Audit completed', summary);

    // Log summary to audit table
    await database.logAuditEvent('AUDIT_SUMMARY', summary);

    context.log(`Audit Summary: ${JSON.stringify(summary)}`);
  } catch (error) {
    logger.error('Audit function error', error);
    throw error;
  }
};
