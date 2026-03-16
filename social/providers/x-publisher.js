const { sha256 } = require('../lib/hash');

class XPublisherAdapter {
  constructor({
    mode = 'fixture',
    clientId = process.env.X_CLIENT_ID,
    clientSecret = process.env.X_CLIENT_SECRET,
    accessToken = process.env.X_ACCESS_TOKEN,
    refreshToken = process.env.X_REFRESH_TOKEN,
    apiBaseUrl = process.env.X_API_BASE_URL || 'https://api.x.com',
  } = {}) {
    this.mode = mode;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.rotatedCredentials = null;
  }

  async publish({ payload }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.publishLive({ payload });
    }

    return {
      ok: true,
      provider: 'x-fixture',
      external_post_id: `x-fixture-${sha256(payload.text).slice(0, 10)}`,
      delivered_at: new Date().toISOString(),
    };
  }

  async publishLive({ payload }) {
    if (!payload.text || !String(payload.text).trim()) {
      throw new Error('Missing X post text.');
    }
    if (!this.accessToken) {
      throw new Error('Missing X_ACCESS_TOKEN for live X publish.');
    }

    let response = await this.publishWithToken({ payload, accessToken: this.accessToken });
    if (response.ok) return response.result;

    const shouldAttemptRefresh = response.status === 401 && this.refreshToken && this.clientId;
    if (!shouldAttemptRefresh) {
      throw new Error(`X publish failed (${response.status}): ${response.body}`);
    }

    const refreshed = await this.refreshAccessToken();
    this.accessToken = refreshed.access_token;
    if (refreshed.refresh_token) this.refreshToken = refreshed.refresh_token;
    this.rotatedCredentials = {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
    };

    response = await this.publishWithToken({ payload, accessToken: this.accessToken });
    if (!response.ok) {
      throw new Error(`X publish failed after refresh (${response.status}): ${response.body}`);
    }

    return response.result;
  }

  async publishWithToken({ payload, accessToken }) {
    const endpoint = `${this.apiBaseUrl}/2/tweets`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: payload.text }),
    });

    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body,
      };
    }

    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      parsed = {};
    }

    return {
      ok: true,
      status: response.status,
      result: {
        ok: true,
        provider: 'x-api-live',
        external_post_id: parsed?.data?.id || `x-${Date.now()}`,
        delivered_at: new Date().toISOString(),
        response: parsed,
      },
    };
  }

  async refreshAccessToken() {
    if (!this.clientId || !this.refreshToken) {
      throw new Error('Missing X OAuth2 refresh credentials.');
    }

    const endpoint = 'https://api.x.com/2/oauth2/token';
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (this.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.clientId,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`X token refresh failed (${response.status}): ${text}`);
    }

    const parsed = JSON.parse(text);
    if (!parsed.access_token) {
      throw new Error('X token refresh response did not include access_token.');
    }

    return parsed;
  }

  getRotatedCredentials() {
    if (!this.rotatedCredentials) return null;
    return { ...this.rotatedCredentials };
  }
}

module.exports = {
  XPublisherAdapter,
};
