/**
 * Test Server Endpoints
 */

const assert = require('assert');
const http = require('http');
const { app } = require('../src/server');
const logger = require('../src/utils/logger');

async function testServer() {
  logger.step(1, 'Testing Server HTTP Endpoints');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(3001, resolve));
  logger.info('Test server listening on port 3001');

  // Test GET /
  const getIndex = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    }).on('error', reject);
  });

  assert.strictEqual(getIndex.statusCode, 200, 'GET / should return 200');
  assert.ok(getIndex.data.includes('WhatsApp Group Contact Extractor'), 'HTML should contain title');
  logger.success('GET / returned dashboard HTML successfully.');

  // Test GET /api/status
  const getStatus = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/status', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data: JSON.parse(data) }));
    }).on('error', reject);
  });

  assert.strictEqual(getStatus.statusCode, 200, 'GET /api/status should return 200');
  assert.strictEqual(getStatus.data.status, 'disconnected', 'Status should be disconnected');
  logger.success('GET /api/status returned JSON status.');

  server.close();
  logger.success('Server HTTP endpoint tests passed!');
  process.exit(0);
}

testServer().catch(err => {
  logger.error('Server endpoint test failed:', err);
  process.exit(1);
});

