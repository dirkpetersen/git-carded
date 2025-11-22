const logger = require('../../shared/logger');
const github = require('../../shared/github');
const database = require('../../shared/database');

/**
 * GitHub Webhook function - Receives GitHub events and logs them
 * POST /api/GithubWebhook
 *
 * Validates HMAC signature from GitHub
 * Logs member events for audit trail
 */
module.exports = async function (context, req) {
  try {
    logger.initializeAppInsights(context);

    // Validate webhook signature
    const signature = req.headers['x-hub-signature-256'] || '';
    const payload = JSON.stringify(req.body);

    if (!github.validateWebhookSignature(payload, signature)) {
      logger.warning('Invalid webhook signature');
      context.res = {
        status: 403,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
      return;
    }

    const event = req.headers['x-github-event'];
    const action = req.body.action;

    logger.info(`GitHub Webhook received: ${event}/${action}`);

    // Initialize database for logging
    await database.initializeDatabase();

    // Process member events
    if (event === 'member' || event === 'organization') {
      const member = req.body.member || req.body.sender;

      if (member) {
        const eventData = {
          event: event,
          action: action,
          username: member.login,
          timestamp: new Date().toISOString(),
          installationId: req.body.installation?.id
        };

        logger.info(`Processing GitHub event: ${event}/${action}`, eventData);

        // Log to audit table
        await database.logAuditEvent(`GITHUB_${event.toUpperCase()}_${action.toUpperCase()}`, eventData);
      }
    }

    // Always return 200 OK to GitHub to acknowledge receipt
    context.res = {
      status: 200,
      body: JSON.stringify({ success: true })
    };

    logger.info('Webhook processed successfully');
  } catch (error) {
    logger.error('Webhook error', error);

    // Still return 200 to prevent GitHub from retrying
    context.res = {
      status: 200,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
