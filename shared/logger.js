/**
 * Logger wrapper - uses Application Insights if available, falls back to console
 */

let appInsightsClient = null;

function initializeAppInsights(context) {
  // Application Insights integration with Azure Functions
  // The context parameter is the Azure Functions context object
  // This allows automatic tracking of traces and exceptions
  if (context && context.log) {
    appInsightsClient = context;
  }
}

function info(message, data = null) {
  const logMessage = data ? `${message} - ${JSON.stringify(data)}` : message;
  console.log(`[INFO] ${logMessage}`);

  if (appInsightsClient && appInsightsClient.log) {
    appInsightsClient.log(logMessage);
  }
}

function error(message, error) {
  const errorMessage = error ? `${message} - ${error.message || JSON.stringify(error)}` : message;
  console.error(`[ERROR] ${errorMessage}`);

  if (appInsightsClient) {
    if (appInsightsClient.log.error) {
      appInsightsClient.log.error(errorMessage);
    } else if (appInsightsClient.log) {
      appInsightsClient.log(errorMessage);
    }
  }

  // Also log stack trace if available
  if (error && error.stack) {
    console.error(`Stack: ${error.stack}`);
  }
}

function warning(message, data = null) {
  const logMessage = data ? `${message} - ${JSON.stringify(data)}` : message;
  console.warn(`[WARN] ${logMessage}`);

  if (appInsightsClient && appInsightsClient.log) {
    appInsightsClient.log(logMessage);
  }
}

function debug(message, data = null) {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
    const logMessage = data ? `${message} - ${JSON.stringify(data)}` : message;
    console.debug(`[DEBUG] ${logMessage}`);
  }
}

module.exports = {
  initializeAppInsights,
  info,
  error,
  warning,
  debug
};
