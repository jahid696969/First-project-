// Process-local, conservative rolling-window guard. Not an organization-wide
// quota meter. Share this instance across all conversations using one provider.
export function createRateLimiter({ rpm = 30, tpm = 8000, now = Date.now } = {}) {
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 30 || !Number.isInteger(tpm) || tpm < 1 || tpm > 8000) throw new Error('invalid_rate_limits');
  let entries = [], blockedUntil = 0;
  function reject(reason, delay) {
    const error = new Error(reason);
    error.retryAfterMs = Math.max(1, Math.ceil(delay));
    throw error;
  }
  return {
    reserve(tokens) {
      const time = now();
      entries = entries.filter(e => time - e.at < 60000);
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('invalid_token_estimate');
      if (tokens > tpm) throw new Error('token_budget_exceeded');
      if (time < blockedUntil) reject('quota_exhausted', blockedUntil - time);
      if (entries.length >= rpm || entries.reduce((n, e) => n + e.tokens, 0) + tokens > tpm) {
        reject('local_rate_limit', entries[0].at + 60000 - time);
      }
      const entry = { at: time, tokens };
      entries.push(entry);
      return {
        settle(actualTokens) {
          // Never refund the original estimate: provider accounting can differ.
          if (Number.isSafeInteger(actualTokens) && actualTokens >= 0) entry.tokens = Math.max(entry.tokens, actualTokens);
        }
      };
    },
    observe(headers, status) {
      const time = now();
      const get = name => headers?.get?.(name);
      if (status === 429) {
        const retry = get('retry-after');
        const delay = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || '') - time;
        blockedUntil = Math.max(blockedUntil, time + (Number.isFinite(delay) && delay > 0 ? delay : 60000));
      }
      for (const kind of ['requests', 'tokens']) {
        const remaining = get(`x-ratelimit-remaining-${kind}`);
        if (remaining !== null && remaining !== undefined && remaining.trim() !== '' && Number(remaining) === 0) {
          const reset = get(`x-ratelimit-reset-${kind}`) || '';
          let duration = 0, consumed = '';
          for (const match of reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
            duration += Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 })[match[2]];
            consumed += match[0];
          }
          if (consumed !== reset || !duration) duration = 60000;
          blockedUntil = Math.max(blockedUntil, time + duration);
        }
      }
      return Math.max(0, blockedUntil - time);
    }
  };
}
