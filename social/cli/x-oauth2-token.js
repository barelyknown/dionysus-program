#!/usr/bin/env node
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { URL } = require('url');

const { parseArgs, printJson, fail } = require('../lib/cli');
const { fileExists, readText, writeText } = require('../lib/fs');

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8787/x/callback';
const DEFAULT_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function createCodeChallenge(verifier) {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

function createState() {
  return base64Url(crypto.randomBytes(24));
}

function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function openBrowser(url) {
  const commands = process.platform === 'darwin'
    ? [['open', [url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '', url]]]
      : [['xdg-open', [url]]];

  for (const [command, args] of commands) {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.unref();
      return true;
    } catch (error) {
      // Try next launcher.
    }
  }
  return false;
}

function mergeEnvText(existing, updates) {
  const lines = String(existing || '').split(/\r?\n/);
  const seen = new Set();
  const merged = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) merged.push(`${key}=${value}`);
  }

  return `${merged.filter((line, index, list) => !(index === list.length - 1 && line === '')).join('\n')}\n`;
}

async function exchangeCodeForTokens({
  code,
  clientId,
  clientSecret = '',
  redirectUri,
  codeVerifier,
}) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers,
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

function waitForAuthorizationCode({ redirectUri, expectedState, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const redirectUrl = new URL(redirectUri);
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, `${redirectUrl.protocol}//${redirectUrl.host}`);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const state = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');

      if (error) {
        res.statusCode = 400;
        res.end(`Authorization failed: ${error}`);
        cleanup(new Error(`Authorization failed: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.statusCode = 400;
        res.end('State mismatch');
        cleanup(new Error('State mismatch from X authorization redirect.'));
        return;
      }

      if (!code) {
        res.statusCode = 400;
        res.end('Missing code');
        cleanup(new Error('Missing code from X authorization redirect.'));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('X authorization succeeded. You can return to the terminal.');
      cleanup(null, code);
    });

    const timeout = setTimeout(() => {
      cleanup(new Error(`Timed out waiting for X authorization after ${timeoutMs}ms.`));
    }, timeoutMs);

    function cleanup(error, code) {
      clearTimeout(timeout);
      server.close(() => {
        if (error) reject(error);
        else resolve(code);
      });
    }

    server.listen(Number(redirectUrl.port), redirectUrl.hostname);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args['client-id'] || process.env.X_CLIENT_ID;
  const clientSecret = args['client-secret'] || process.env.X_CLIENT_SECRET || '';
  const redirectUri = args['redirect-uri'] || process.env.X_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const timeoutMs = Number(args['timeout-ms'] || 300000);
  const scopes = String(args.scopes || DEFAULT_SCOPES.join(' '))
    .split(/[,\s]+/)
    .filter(Boolean);
  const envFile = args['env-file'] || '';

  if (!clientId) fail('Missing X client id. Set X_CLIENT_ID or pass --client-id.');

  const redirectUrl = new URL(redirectUri);
  if (redirectUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirectUrl.hostname)) {
    fail(`Redirect URI must be a local http callback for this helper. Use something like ${DEFAULT_REDIRECT_URI}`);
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = createState();
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge,
  });

  process.stdout.write(`Authorize this app in a browser:\n${authorizeUrl}\n\n`);
  process.stdout.write(`Make sure this redirect URI is registered in X:\n${redirectUri}\n\n`);

  const waitForCode = waitForAuthorizationCode({
    redirectUri,
    expectedState: state,
    timeoutMs,
  });

  if (!args['no-open']) {
    const opened = openBrowser(authorizeUrl);
    if (!opened) process.stdout.write('Could not open a browser automatically. Open the URL above manually.\n\n');
  }

  const code = await waitForCode;
  const tokens = await exchangeCodeForTokens({
    code,
    clientId,
    clientSecret,
    redirectUri,
    codeVerifier,
  });

  const result = {
    ok: true,
    redirect_uri: redirectUri,
    scopes,
    client_id: clientId,
    access_token: tokens.access_token || null,
    refresh_token: tokens.refresh_token || null,
    expires_in: tokens.expires_in || null,
    token_type: tokens.token_type || null,
  };

  if (envFile) {
    const nextEnv = mergeEnvText(fileExists(envFile) ? readText(envFile, '') : '', {
      X_CLIENT_ID: clientId,
      ...(clientSecret ? { X_CLIENT_SECRET: clientSecret } : {}),
      X_ACCESS_TOKEN: result.access_token || '',
      X_REFRESH_TOKEN: result.refresh_token || '',
    });
    writeText(envFile, nextEnv);
    result.env_file = envFile;
  }

  printJson(result);
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  DEFAULT_REDIRECT_URI,
  DEFAULT_SCOPES,
  buildAuthorizeUrl,
  createCodeVerifier,
  createCodeChallenge,
  mergeEnvText,
};
