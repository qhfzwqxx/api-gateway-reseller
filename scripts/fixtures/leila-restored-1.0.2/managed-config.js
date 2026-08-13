'use strict';

const MANAGED_UPSTREAM_URL = 'https://moxinggang.com/v1';
const OFFICIAL_UPSTREAM_URL = 'https://api.openai.com/v1';

function validateApiKey(value) {
  const key = String(value || '').trim();
  if (!key) throw new Error('API Key 不可用');
  if (key.length > 16 * 1024) throw new Error('API Key 超过 16 KiB');
  if (/\r|\n/u.test(key)) throw new Error('API Key 包含非法换行');
  return key;
}

module.exports = {
  MANAGED_UPSTREAM_URL,
  OFFICIAL_UPSTREAM_URL,
  validateApiKey,
};
