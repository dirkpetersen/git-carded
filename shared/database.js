const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const logger = require('./logger');

let tableClient;

/**
 * Initialize Table Storage client
 */
async function initializeDatabase() {
  try {
    const connectionString = process.env.AzureWebJobsStorage;
    const tableName = 'UserMappings';

    tableClient = TableClient.fromConnectionString(connectionString, tableName);

    // Ensure table exists
    await tableClient.createTable().catch(err => {
      if (err.code !== 'TableAlreadyExists') {
        throw err;
      }
    });

    logger.info('Database initialized successfully');
    return tableClient;
  } catch (error) {
    logger.error('Failed to initialize database', error);
    throw error;
  }
}

/**
 * Get table client instance
 */
function getTableClient() {
  if (!tableClient) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return tableClient;
}

/**
 * Create or update user mapping
 */
async function upsertUserMapping(corporateEmail, githubUsername) {
  try {
    const entity = {
      partitionKey: process.env.GITHUB_ORG_NAME || 'oregonstate-ai',
      rowKey: corporateEmail,
      GitHubUsername: githubUsername,
      LastLoginTimestamp: new Date().toISOString(),
      IsActive: true,
      CreatedAt: new Date().toISOString()
    };

    const client = getTableClient();
    await client.upsertEntity(entity, 'Replace');

    logger.info(`User mapping created/updated: ${corporateEmail} <-> ${githubUsername}`);
    return entity;
  } catch (error) {
    logger.error(`Failed to upsert user mapping for ${corporateEmail}`, error);
    throw error;
  }
}

/**
 * Get user mapping by corporate email
 */
async function getUserMapping(corporateEmail) {
  try {
    const client = getTableClient();
    const entity = await client.getEntity(
      process.env.GITHUB_ORG_NAME || 'oregonstate-ai',
      corporateEmail
    );
    return entity;
  } catch (error) {
    if (error.code === 'ResourceNotFound') {
      return null;
    }
    logger.error(`Failed to get user mapping for ${corporateEmail}`, error);
    throw error;
  }
}

/**
 * Update last login timestamp
 */
async function updateLastLogin(corporateEmail) {
  try {
    const entity = await getUserMapping(corporateEmail);
    if (!entity) {
      throw new Error(`User mapping not found for ${corporateEmail}`);
    }

    entity.LastLoginTimestamp = new Date().toISOString();
    entity.IsActive = true;

    const client = getTableClient();
    await client.updateEntity(entity, 'Replace');

    logger.info(`Updated last login for ${corporateEmail}`);
    return entity;
  } catch (error) {
    logger.error(`Failed to update last login for ${corporateEmail}`, error);
    throw error;
  }
}

/**
 * Get all user mappings (for audit)
 */
async function getAllUserMappings() {
  try {
    const client = getTableClient();
    const partitionKey = process.env.GITHUB_ORG_NAME || 'oregonstate-ai';

    const entities = [];
    for await (const entity of client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}'` }
    })) {
      entities.push(entity);
    }

    return entities;
  } catch (error) {
    logger.error('Failed to get all user mappings', error);
    throw error;
  }
}

/**
 * Delete user mapping
 */
async function deleteUserMapping(corporateEmail) {
  try {
    const client = getTableClient();
    await client.deleteEntity(
      process.env.GITHUB_ORG_NAME || 'oregonstate-ai',
      corporateEmail
    );

    logger.info(`User mapping deleted: ${corporateEmail}`);
  } catch (error) {
    if (error.code !== 'ResourceNotFound') {
      logger.error(`Failed to delete user mapping for ${corporateEmail}`, error);
      throw error;
    }
  }
}

/**
 * Log audit event
 */
async function logAuditEvent(event, details) {
  try {
    // Get sessions table
    const connectionString = process.env.AzureWebJobsStorage;
    const auditTableClient = TableClient.fromConnectionString(connectionString, 'AuditLogs');

    const auditEntity = {
      partitionKey: process.env.GITHUB_ORG_NAME || 'oregonstate-ai',
      rowKey: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      Event: event,
      Details: JSON.stringify(details),
      Timestamp: new Date().toISOString()
    };

    await auditTableClient.upsertEntity(auditEntity, 'Replace');
    logger.info(`Audit event logged: ${event}`);
  } catch (error) {
    logger.error('Failed to log audit event', error);
    // Don't throw - audit logging should not break the main flow
  }
}

module.exports = {
  initializeDatabase,
  getTableClient,
  upsertUserMapping,
  getUserMapping,
  updateLastLogin,
  getAllUserMappings,
  deleteUserMapping,
  logAuditEvent
};
