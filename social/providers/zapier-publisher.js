const { sha256 } = require('../lib/hash');

function activityUrnFromUrl(postUrl) {
  const match = String(postUrl || '').match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

class ZapierPublisherAdapter {
  constructor({ mode = 'fixture', webhookUrl = process.env.ZAPIER_LINKEDIN_WEBHOOK_URL } = {}) {
    this.mode = mode;
    this.webhookUrl = webhookUrl;
  }

  async publish({ payload }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.publishLive({ payload });
    }
    return {
      ok: true,
      provider: 'zapier-fixture',
      external_post_id: `fixture-${sha256(payload.final_text).slice(0, 10)}`,
      delivered_at: new Date().toISOString(),
      linkedin_post_url: null,
      linkedin_activity_urn: null,
    };
  }

  async publishLive({ payload }) {
    if (!this.webhookUrl) throw new Error('Missing ZAPIER_LINKEDIN_WEBHOOK_URL for live publish.');
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Zapier publish failed (${response.status}): ${await response.text()}`);
    }
    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = { raw: await response.text() };
    }
    return {
      ok: true,
      provider: 'zapier-live',
      external_post_id: body.id || body.post_id || `zapier-${Date.now()}`,
      delivered_at: new Date().toISOString(),
      linkedin_post_url: body.url || body.post_url || null,
      linkedin_activity_urn: body.activity_urn || activityUrnFromUrl(body.url || body.post_url || null),
      response: body,
    };
  }
}

module.exports = {
  ZapierPublisherAdapter,
};
