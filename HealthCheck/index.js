/**
 * HealthCheck function - Verifies system connectivity
 * GET /api/HealthCheck
 */
module.exports = async function (context, req) {
  try {
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        status: 'OK',
        timestamp: new Date().toISOString(),
        message: 'GitHub Identity Bridge is running'
      }
    };
  } catch (error) {
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: {
        error: 'Health check failed',
        message: error.message
      }
    };
  }
};
