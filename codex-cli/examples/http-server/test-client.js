#!/usr/bin/env node

/**
 * Simple test client for Codex HTTP server (Read-Only Mode)
 * 
 * Usage:
 *   node test-client.js "Explain what this codebase does"
 *   node test-client.js "Find all the React components in this project"
 *   node test-client.js "What's the main entry point of this application?"
 * 
 * Note: HTTP mode is read-only - it can analyze code but not modify it.
 */

import http from 'node:http';

const BASE_URL = 'http://localhost:3000';

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testChat(prompt, approvalMode = 'suggest') {
  console.log(`🤖 Sending: "${prompt}"`);
  console.log(`📋 Mode: Read-Only (HTTP mode ignores approval mode)`);
  console.log('⏳ Waiting for response...\n');
  
  try {
    const result = await makeRequest('POST', '/chat', {
      prompt,
    });

    if (result.status === 200) {
      console.log(`✅ Session ID: ${result.data.sessionId}`);
      console.log(`📊 Status: ${result.data.status}`);
      console.log(`💬 Messages received: ${result.data.messages.length}\n`);
      
      // Display conversation
      for (const message of result.data.messages) {
        if (message.role === 'assistant' && typeof message.content === 'string') {
          console.log(`🤖 Assistant: ${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}`);
        } else if (message.role === 'tool') {
          console.log(`🔧 Tool output received`);
        }
      }
      
      if (result.data.error) {
        console.log(`❌ Error: ${result.data.error}`);
      }
    } else {
      console.log(`❌ Error ${result.status}:`, result.data);
    }
  } catch (error) {
    console.log(`❌ Request failed:`, error.message);
  }
}

async function testHealth() {
  console.log('🔍 Checking server health...');
  try {
    const result = await makeRequest('GET', '/health');
    console.log('✅ Health check:', result.data);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
  }
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const prompt = args.find(arg => !arg.startsWith('--'));
  const approvalModeIndex = args.indexOf('--approval-mode');
  const approvalMode = approvalModeIndex >= 0 ? args[approvalModeIndex + 1] : 'suggest';

  if (!prompt) {
    console.log('Usage: node test-client.js "your prompt here"');
    console.log('Examples:');
    console.log('  node test-client.js "Explain what this codebase does"');
    console.log('  node test-client.js "Find all TypeScript files in src/"');
    console.log('  node test-client.js "What are the main components in this React app?"');
    process.exit(1);
  }

  await testHealth();
  await testChat(prompt, approvalMode);
}

main().catch(console.error);