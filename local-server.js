#!/usr/bin/env node

/**
 * Simple local HTTP server for testing without Azure Functions Core Tools
 * Run: node local-server.js
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Load environment variables from local.settings.json
try {
  const settingsPath = path.join(__dirname, 'local.settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.Values) {
      Object.entries(settings.Values).forEach(([key, value]) => {
        process.env[key] = value;
      });
    }
    console.log('✓ Loaded configuration from local.settings.json');
  }
} catch (error) {
  console.warn('Warning: Could not load local.settings.json:', error.message);
}

// Import functions
const Login = require('./functions/Login');
const AuthCallback = require('./functions/AuthCallback');
const HealthCheck = require('./functions/HealthCheck');
const GithubWebhook = require('./functions/GithubWebhook');

const PORT = process.env.PORT || 7071;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Mock Azure Functions context
  const context = {
    log: console.log,
    res: null
  };

  // Mock request object
  const mockReq = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: parsedUrl.query,
    body: null
  };

  // Parse body for POST requests
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    await new Promise(resolve => req.on('end', resolve));
    try {
      mockReq.body = JSON.parse(body);
    } catch (e) {
      mockReq.body = body;
    }
  }

  try {
    // Route to appropriate function
    if (pathname === '/api/Login') {
      await Login(context, mockReq);
    } else if (pathname === '/api/AuthCallback') {
      await AuthCallback(context, mockReq);
    } else if (pathname === '/api/HealthCheck') {
      await HealthCheck(context, mockReq);
    } else if (pathname === '/api/GithubWebhook') {
      await GithubWebhook(context, mockReq);
    } else {
      context.res = {
        status: 404,
        body: JSON.stringify({ error: 'Endpoint not found' })
      };
    }

    // Send response
    const response = context.res || { status: 200, body: 'OK' };
    res.writeHead(response.status || 200, response.headers || { 'Content-Type': 'application/json' });
    res.end(typeof response.body === 'string' ? response.body : JSON.stringify(response.body));

  } catch (error) {
    console.error('Error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error', message: error.message }));
  }
});

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  GitHub Identity Bridge - Local Development Server        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  • http://localhost:${PORT}/api/Login`);
  console.log(`  • http://localhost:${PORT}/api/AuthCallback`);
  console.log(`  • http://localhost:${PORT}/api/HealthCheck`);
  console.log(`  • http://localhost:${PORT}/api/GithubWebhook`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
  console.log('Note: This is a simple dev server. For production-like testing,');
  console.log('install Azure Functions Core Tools: ./scripts/setup-local.sh');
});
