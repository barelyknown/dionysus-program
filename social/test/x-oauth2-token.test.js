const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SCOPES,
  buildAuthorizeUrl,
  createCodeVerifier,
  createCodeChallenge,
  mergeEnvText,
} = require('../cli/x-oauth2-token');

test('PKCE helper builds an authorize URL with required params', () => {
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);
  const url = new URL(buildAuthorizeUrl({
    clientId: 'client-123',
    redirectUri: 'http://127.0.0.1:8787/x/callback',
    scopes: DEFAULT_SCOPES,
    state: 'state-abc',
    codeChallenge: challenge,
  }));

  assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8787/x/callback');
  assert.equal(url.searchParams.get('scope'), DEFAULT_SCOPES.join(' '));
  assert.equal(url.searchParams.get('state'), 'state-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
});

test('mergeEnvText updates existing entries and appends missing ones', () => {
  const merged = mergeEnvText(
    'OPENAI_API_KEY=old\nX_CLIENT_ID=old-client\n',
    {
      X_CLIENT_ID: 'new-client',
      X_ACCESS_TOKEN: 'access-123',
      X_REFRESH_TOKEN: 'refresh-456',
    }
  );

  assert.match(merged, /OPENAI_API_KEY=old/);
  assert.match(merged, /X_CLIENT_ID=new-client/);
  assert.match(merged, /X_ACCESS_TOKEN=access-123/);
  assert.match(merged, /X_REFRESH_TOKEN=refresh-456/);
});
