import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroqProvider, GROQ_MODEL } from '../src/providers/groq.js';
import { createRateLimiter } from '../src/providers/rate-limit.js';
import { createAssistant } from '../src/assistant.js';
import { OUTPUT_SCHEMA } from '../src/provider-output.js';

const context = { message: 'Need a tutor class 7', context: { fields: {} } };
const input = (id = '1', conversationId = 'a') => ({ text: context.message, messageId: id, conversationId });
function wire(overrides = {}) {
  return { intent: 'guardian', extractedFields: Object.fromEntries(Object.keys(OUTPUT_SCHEMA.properties.extractedFields.properties).map(k => [k, k === 'class' ? 7 : null])),
    evidence: Object.fromEntries(Object.keys(OUTPUT_SCHEMA.properties.evidence.properties).map(k => [k, k === 'class' ? 'class 7' : null])),
    ambiguousFields: [], policyTopics: [], jobId: null, reply: 'কোন বিষয় পড়াতে হবে?', needsHuman: false, reason: null, ...overrides };
}
function response({ status = 200, output = wire(), headers = {}, usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, finish = 'stop' } = {}) {
  return { ok: status < 400, status, headers: new Headers(headers), json: async () => ({
    choices: [{ finish_reason: finish, message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }], usage
  }) };
}
const make = (fetchImpl, extra = {}) => createGroqProvider({ enabled: true, apiKey: 'synthetic-test-key', fetchImpl, ...extra });

test('Groq sends exact approved model, endpoint, Bearer auth and strict nullable schema', async () => {
  let captured, usage;
  const p = make(async (url, options) => { captured = { url, options }; return response(); });
  const result = await p.analyze(context, { onUsage: u => { usage = u; } });
  assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, 'Bearer synthetic-test-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.max_completion_tokens, 1536);
  assert.equal(body.tools, undefined);
  assert.equal(body.response_format.json_schema.strict, true);
  const schema = body.response_format.json_schema.schema;
  for (const name of ['extractedFields', 'evidence']) {
    assert.deepEqual(schema.properties[name].required, Object.keys(schema.properties[name].properties));
    assert.ok(schema.properties[name].properties.class.type.includes('null'));
  }
  assert.deepEqual(result.extractedFields, { class: 7 });
  assert.deepEqual(usage, { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 });
});
test('disabled, missing key and other model never call transport', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
  for (const options of [{ enabled: false }, { apiKey: '' }, { model: 'openai/other' }]) {
    await assert.rejects(make(fetchImpl, options).analyze(context));
  }
  assert.equal(calls, 0);
  assert.equal(GROQ_MODEL, 'openai/gpt-oss-20b');
});
test('rolling request guard permits exactly 30 reservations, resets after 60 seconds', () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  for (let i = 0; i < 30; i++) limiter.reserve(1);
  assert.throws(() => limiter.reserve(1), e => e.message === 'local_rate_limit' && e.retryAfterMs === 60000);
  time = 59999;
  assert.throws(() => limiter.reserve(1), /local_rate_limit/);
  time = 60000;
  limiter.reserve(1);
});
test('rolling token guard caps reserved tokens at 8000', () => {
  const limiter = createRateLimiter();
  limiter.reserve(4000); limiter.reserve(4000);
  assert.throws(() => limiter.reserve(1), /local_rate_limit/);
  assert.throws(() => limiter.reserve(8001), /token_budget_exceeded/);
});
test('limits cannot be configured above approved ceilings', () => {
  for (const options of [{ rpm: 31 }, { tpm: 8001 }, { rpm: 0 }, { tpm: NaN }]) assert.throws(() => createRateLimiter(options), /invalid_rate_limits/);
});
test('actual usage can increase, never refund, a token reservation', () => {
  const limiter = createRateLimiter();
  const reservation = limiter.reserve(1000);
  reservation.settle(7500);
  assert.throws(() => limiter.reserve(501), /local_rate_limit/);
  reservation.settle(1);
  assert.throws(() => limiter.reserve(501), /local_rate_limit/);
});
test('concurrent conversations share provider token limit; excess requests never send', async () => {
  let calls = 0;
  const p = make(async () => { calls++; return response(); });
  const app = createAssistant({ provider: p });
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => app.handle(input('1', String(i)))));
  assert.ok(calls >= 1 && calls < 5);
  assert.ok(results.some(r => r.providerStatus === 'local_rate_limit'));
  assert.equal(results.filter(r => r.engineMode === 'llm').length, calls);
});
test('oversized context fails without transport; no silent truncation', async () => {
  let calls = 0;
  const p = make(async () => { calls++; return response(); });
  await assert.rejects(p.analyze({ message: 'ব'.repeat(5000) }), /token_budget_exceeded/);
  assert.equal(calls, 0);
});
test('missing usage does not manufacture token counts', async () => {
  let called = false;
  await make(async () => response({ usage: null })).analyze(context, { onUsage: () => { called = true; } });
  assert.equal(called, false);
});
test('429 Retry-After blocks next transport call and expires without auto retry', async () => {
  let time = 0, calls = 0;
  const p = make(async () => { calls++; return response({ status: 429, headers: { 'retry-after': '120' } }); }, { now: () => time });
  await assert.rejects(p.analyze(context), e => e.message === 'quota_exhausted' && e.retryAfterMs === 120000 && e.httpStatus === 429);
  time = 61000;
  await assert.rejects(p.analyze(context), /quota_exhausted/);
  assert.equal(calls, 1);
  time = 120000;
  await assert.rejects(p.analyze(context), /quota_exhausted/);
  assert.equal(calls, 2); // explicit new call only
});
test('Retry-After HTTP dates and unknown limits are handled conservatively', () => {
  let time = Date.parse('2026-10-27T00:00:00Z');
  const limiter = createRateLimiter({ now: () => time });
  assert.equal(limiter.observe(new Headers({ 'retry-after': 'Tue, 27 Oct 2026 00:02:00 GMT' }), 429), 120000);
  time += 1000;
  assert.throws(() => limiter.reserve(1), e => e.retryAfterMs === 119000);
});
test('server remaining-token zero and duration reset gate future requests', () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  assert.equal(limiter.observe(new Headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '1m2.5s' }), 200), 62500);
  assert.throws(() => limiter.reserve(1), /quota_exhausted/);
  time = 62500; limiter.reserve(1);
});
test('positive remaining headers do not disable local limits', () => {
  const limiter = createRateLimiter();
  limiter.observe(new Headers({ 'x-ratelimit-remaining-tokens': '999999' }), 200);
  limiter.reserve(8000);
  assert.throws(() => limiter.reserve(1), /local_rate_limit/);
});
for (const [status, reason] of [[400, 'invalid_request'], [401, 'auth_error'], [403, 'auth_error'], [404, 'model_unavailable'], [429, 'quota_exhausted'], [500, 'provider_error'], [503, 'service_unavailable']]) {
  test(`Groq HTTP ${status} maps safely to ${reason}, once`, async () => {
    let calls = 0;
    const app = createAssistant({ provider: make(async () => { calls++; return response({ status }); }) });
    const out = await app.handle(input());
    assert.equal(calls, 1);
    assert.equal(out.providerStatus, reason);
    assert.equal(out.httpStatus, status);
    assert.equal(out.provider, 'groq');
    assert.equal(out.engineMode, 'rules');
    assert.equal(out.knownFields.class, 7);
    assert.doesNotMatch(JSON.stringify(out), /synthetic-test-key|Authorization/);
  });
}
test('unauthorized provider disabled across subsequent messages', async () => {
  let calls = 0;
  const p = make(async () => { calls++; return response({ status: 403 }); });
  await assert.rejects(p.analyze(context), /auth_error/);
  await assert.rejects(p.analyze(context), /auth_error/);
  assert.equal(calls, 1);
});
test('malformed, truncated, refusal, empty, unknown field and invalid evidence responses fall back safely', async () => {
  const scenarios = [
    [response({ output: 'bad json' }), 'invalid_output'],
    [response({ finish: 'length' }), 'incomplete_output'],
    [response({ finish: 'content_filter' }), 'provider_refusal'],
    [response({ output: '' }), 'invalid_output'],
    [response({ output: wire({ extra: true }) }), 'invalid_output'],
    [response({ output: wire({ evidence: { class: 'not in message' } }) }), 'invalid_output']
  ];
  for (const [mock, expected] of scenarios) {
    const app = createAssistant({ provider: make(async () => mock) });
    const out = await app.handle(input());
    assert.equal(out.providerStatus, expected);
    if (expected === 'provider_refusal') assert.equal(out.nextAction, 'human_handoff');
    else assert.equal(out.knownFields.class, 7);
  }
});
test('Groq duplicate and paused conversation make no extra calls', async () => {
  let calls = 0;
  const app = createAssistant({ provider: make(async () => { calls++; return response(); }) });
  await app.handle(input());
  assert.equal((await app.handle(input())).nextAction, 'duplicate_ignored');
  await app.handle({ ...input('2'), control: 'pause' });
  assert.equal((await app.handle(input('3'))).nextAction, 'automation_paused');
  assert.equal(calls, 1);
});
test('Groq network error is sanitized; timeout respects cancellation', async () => {
  const p = make(async () => { throw new Error('secret transport information'); });
  await assert.rejects(p.analyze(context), e => e.message === 'provider_error');
  let signal;
  const app = createAssistant({ timeoutMs: 5, provider: make(async (_, options) => {
    signal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  }) });
  const out = await app.handle(input());
  assert.equal(out.providerStatus, 'timeout');
  assert.ok(signal.aborted);
});
test('aborted request never reserves quota or calls transport', async () => {
  let calls = 0, reservations = 0;
  const p = make(async () => { calls++; return response(); }, { limiter: { reserve() { reservations++; }, observe() {} } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(p.analyze(context, { signal: controller.signal }), /timeout/);
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
});
test('Groq session call cap is independent from rolling limits and does not retry', async () => {
  let time = 0, calls = 0;
  const p = make(async () => { calls++; return response(); }, { maxCalls: 1, now: () => time });
  await p.analyze(context);
  time = 120000;
  await assert.rejects(p.analyze(context), /local_call_limit/);
  assert.equal(calls, 1);
});
test('CLI refuses live Groq without opt-in, refuses multiple providers and live fixtures', async () => {
  const args = process.argv;
  try {
    process.argv = ['node', 'cli', '--groq'];
    await assert.rejects(import('../src/cli.js?groq-no-optin'), /allow-api-tests/);
    process.argv = ['node', 'cli', '--groq', '--gemini', '--allow-api-tests'];
    await assert.rejects(import('../src/cli.js?groq-two-providers'), /one provider/);
    process.argv = ['node', 'cli', '--groq', '--allow-api-tests', '--fixtures'];
    await assert.rejects(import('../src/cli.js?groq-no-live-fixtures'), /never call/);
  } finally { process.argv = args; }
});

test('Bangla guardian example validates canonical facts with verbatim evidence', async () => {
  const message = 'আমার বাচ্চা সপ্তম শ্রেণিতে, অঙ্কে সাহায্য প্রয়োজন';
  let prompt;
  const output = wire({ extractedFields: { class: 7, subject: 'Math' }, evidence: { class: 'সপ্তম', subject: 'অঙ্ক' }, reply: 'কোন এলাকায় টিউটর প্রয়োজন?' });
  const app = createAssistant({ provider: make(async (_, options) => {
    prompt = JSON.parse(options.body).messages[0].content;
    return response({ output });
  }) });
  const out = await app.handle({ text: message, messageId: 'bn-1', conversationId: 'bn' });
  assert.equal(out.providerStatus, 'validated');
  assert.equal(out.engineMode, 'llm');
  assert.equal(out.knownFields.class, 7);
  assert.equal(out.knownFields.subject, 'Math');
  assert.match(prompt, /copied verbatim/);
  assert.match(prompt, /Canonical subject names/);
});

test('invalid output diagnostics identify evidence conflict without exposing response content', async () => {
  const app = createAssistant({ provider: make(async () => response({ output: wire({ extractedFields: { class: 8 } }) })) });
  const out = await app.handle(input());
  assert.equal(out.providerStatus, 'invalid_output');
  assert.equal(out.validationCode, 'evidence_value_conflict');
  assert.equal(out.engineMode, 'rules');
  assert.equal(out.knownFields.class, 7);
  assert.doesNotMatch(JSON.stringify(out), /synthetic-test-key/);
});

test('invalid JSON and fabricated evidence remain rejected with safe diagnostics', async () => {
  for (const [output, code] of [['```json {} ```', 'json_parse'], [wire({ evidence: { class: 'class 9' } }), 'invalid_evidence']]) {
    const app = createAssistant({ provider: make(async () => response({ output })) });
    const out = await app.handle(input());
    assert.equal(out.providerStatus, 'invalid_output');
    assert.equal(out.validationCode, code);
    assert.equal(out.engineMode, 'rules');
  }
});
