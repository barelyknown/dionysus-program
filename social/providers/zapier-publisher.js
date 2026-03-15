const { sha256 } = require('../lib/hash');

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
      response: body,
    };
  }
}

module.exports = {
  ZapierPublisherAdapter,
};
