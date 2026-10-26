import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAssistant } from '../src/assistant.js';
import { processMessage } from '../src/engine.js';
import { validateAnalysis } from '../src/provider-output.js';
import { createGeminiProvider } from '../src/providers/gemini.js';
import { after } from 'node:test';

// Any accidental default transport use fails the test run, even if caught by fallback.
const originalFetch = globalThis.fetch;
let unexpectedNetwork = 0;
globalThis.fetch = async () => { unexpectedNetwork++; throw new Error('network forbidden in tests'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(unexpectedNetwork, 0); });

const input = (text = 'Need a tutor class 7', messageId = '1', conversationId = 'a') => ({ text, messageId, conversationId });
const analysis = (overrides = {}) => ({ intent: 'guardian', extractedFields: {}, evidence: {}, ambiguousFields: [], policyTopics: [], jobId: null,
  reply: 'কোন বিষয় পড়াতে হবে?', needsHuman: false, reason: null, ...overrides });
const provider = output => ({ async analyze() { return structuredClone(output); } });
const synthetic = JSON.parse(await readFile(new URL('../fixtures/exceptional-conversations.json', import.meta.url), 'utf8'));

for (const item of synthetic) test(`synthetic contract mock: ${item.id}`, async () => {
  const out = analysis({ intent: item.intent, extractedFields: item.fields,
    evidence: Object.fromEntries(Object.keys(item.fields).map(f => [f, item.text])),
    ambiguousFields: item.ambiguousFields || [], policyTopics: item.policyTopics || [], needsHuman: item.needsHuman || false });
  const assistant = createAssistant({ provider: provider(out) });
  const result = await assistant.handle(input(item.text));
  if (item.needsHuman) assert.equal(result.nextAction, 'human_handoff');
  else for (const [field, value] of Object.entries(item.fields)) assert.equal(result.knownFields[field], value);
  // Mock success tests plumbing/expected outcomes, not actual model accuracy.
});
test('rules baseline retains mixed policy and guardian fields', () => {
  const out = processMessage(input('Need a tutor class 7 math, commission কত?'));
  assert.equal(out.knownFields.class, 7);
  assert.equal(out.knownFields.subject, 'Math');
  assert.match(out.proposedReply, /৫০%/);
  assert.equal(out.state.lastQuestion, 'area');
});
test('default assistant never uses network; transcript marks replies as drafts', async () => {
  const app = createAssistant();
  const out = await app.handle(input());
  assert.equal(out.engineMode, 'rules');
  assert.equal(out.state.history[0].role, 'user');
  assert.equal(out.state.history[1].role, 'assistant_draft');
  const copy = app.getState('a'); copy.fields.class = 99;
  assert.equal(app.getState('a').fields.class, 7);
});
test('parallel duplicates invoke provider and apply facts only once', async () => {
  let calls = 0;
  const app = createAssistant({ provider: { async analyze() { calls++; return analysis(); } } });
  const [a, b] = await Promise.all([app.handle(input()), app.handle(input())]);
  assert.equal(calls, 1);
  assert.equal(b.nextAction, 'duplicate_ignored');
  assert.equal(a.state.version, b.state.version);
});
test('paused, human handoff, empty and duplicate messages skip provider', async () => {
  let calls = 0;
  const app = createAssistant({ provider: { async analyze() { calls++; return analysis(); } } });
  await app.handle({ ...input(), control: 'pause' });
  await app.handle(input('resume', '2'));
  await app.handle(input('Need a tutor', '3', 'b')); // one real mock analysis
  await app.handle(input('Need a tutor', '3', 'b'));
  await app.handle(input('', '4', 'b'));
  await app.handle(input('আমার অভিযোগ আছে', '5', 'b'));
  assert.equal(calls, 1);
});
test('contexts isolated; known state and history supplied only for correct user', async () => {
  const seen = [];
  const app = createAssistant({ provider: { async analyze(ctx) {
    seen.push(structuredClone(ctx));
    return analysis({ extractedFields: { class: ctx.message.includes('7') ? 7 : 5 }, evidence: { class: ctx.message } });
  } } });
  await app.handle(input('class 7'));
  await app.handle(input('class 5', '1', 'b'));
  await app.handle(input('class 7', '2'));
  assert.deepEqual(seen[1].context.fields, {});
  assert.deepEqual(seen[1].context.history, []);
  assert.equal(seen[2].context.fields.class, 7);
});
test('correction is applied, prior state not echoed as fresh evidence', async () => {
  const app = createAssistant({ provider: provider(analysis({ extractedFields: { class: 8 }, evidence: { class: 'অষ্টম শ্রেণি' } })) });
  const out = await app.handle(input('অষ্টম শ্রেণি'));
  assert.equal(out.knownFields.class, 8);
  assert.throws(() => validateAnalysis(analysis({ extractedFields: { class: 7 }, evidence: { class: 'পুরোনো কথা' } }), 'অষ্টম শ্রেণি'), /invalid_output/);
});
for (const code of ['quota_exhausted', 'auth_error', 'model_unavailable', 'provider_error', 'invalid_output', 'incomplete_output', 'missing_key']) {
  test(`fallback once on ${code}`, async () => {
    let calls = 0;
    const app = createAssistant({ provider: { async analyze() { calls++; throw new Error(code); } } });
    const out = await app.handle(input());
    assert.equal(calls, 1);
    assert.equal(out.providerStatus, code);
    assert.equal(out.engineMode, 'rules');
    assert.equal(out.knownFields.class, 7);
    assert.equal(out.state.version, 1);
  });
}
test('timeout aborts and late result cannot change committed state', async () => {
  let signal, resolve;
  const app = createAssistant({ timeoutMs: 5, provider: { analyze(_, options) {
    signal = options.signal; return new Promise(r => { resolve = r; });
  } } });
  const out = await app.handle(input());
  assert.equal(out.providerStatus, 'timeout');
  assert.ok(signal.aborted);
  resolve(analysis());
  await Promise.resolve();
  assert.equal(app.getState('a').fields.class, 7);
});
test('takeover during pending request discards model result, even after explicit resume', async () => {
  let resolve, started;
  const start = new Promise(r => { started = r; });
  const app = createAssistant({ provider: { analyze() { started(); return new Promise(r => { resolve = r; }); } } });
  const pending = app.handle(input());
  await start;
  await app.handle({ ...input('', 'control-1'), control: 'takeover' });
  await app.handle({ ...input('', 'control-2'), control: 'resume' });
  resolve(analysis({ extractedFields: { class: 7 }, evidence: { class: 'class 7' } }));
  const out = await pending;
  assert.equal(out.nextAction, 'stale_result_discarded');
  assert.equal(out.proposedReply, null);
  assert.equal(out.state.mode, 'active');
  assert.deepEqual(out.knownFields, {});
});
test('safety refusal hands off, not an unrestricted rules answer', async () => {
  const app = createAssistant({ provider: { async analyze() { throw new Error('provider_refusal'); } } });
  const out = await app.handle(input());
  assert.equal(out.nextAction, 'human_handoff');
  assert.equal(out.state.mode, 'human_active');
});
test('strict contract rejects malformed fields, missing keys, unknown keys and unsafe drafts', () => {
  const bad = [null, [], {}, analysis({ control: 'resume' }), analysis({ medium: 'English' }),
    analysis({ extractedFields: { class: 99 }, evidence: { class: 'class 99' } }),
    analysis({ extractedFields: { medium: 'English' }, evidence: { medium: 'English' } }),
    analysis({ extractedFields: { genderPreference: 'Other' }, evidence: { genderPreference: 'Other' } }),
    analysis({ reply: '' }), analysis({ reply: 'Verified tutor available' }),
    analysis({ ambiguousFields: ['password'] }), analysis({ needsHuman: 'false' })];
  for (const out of bad) assert.throws(() => validateAnalysis(out, 'class 99 English Other'), /invalid_output/);
});
test('invalid model analysis never partially updates state', async () => {
  const app = createAssistant({ provider: provider(analysis({ extractedFields: { class: 8 }, evidence: { class: 'not in message' } })) });
  const out = await app.handle(input());
  assert.equal(out.providerStatus, 'invalid_output');
  assert.equal(out.knownFields.class, 7);
});
test('model omissions do not discard explicit rule facts', async () => {
  const app = createAssistant({ provider: provider(analysis()) });
  const out = await app.handle(input('Need a tutor class 7 math'));
  assert.equal(out.knownFields.class, 7);
  assert.equal(out.knownFields.subject, 'Math');
});
test('evidence cannot contradict a plainly extracted value', () => {
  assert.throws(() => validateAnalysis(analysis({ extractedFields: { class: 8 }, evidence: { class: 'class 7' } }), 'class 7'), /invalid_output/);
});
test('adapter missing key, disabled and unapproved model make zero transport calls', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('must not call'); };
  for (const options of [{}, { enabled: true }, { enabled: true, apiKey: 'synthetic-key', model: 'paid-other' }]) {
    await assert.rejects(createGeminiProvider({ ...options, fetchImpl }).analyze({}));
  }
  assert.equal(calls, 0);
});
test('REST adapter uses fixed endpoint, header and schema with no tools or retry', async () => {
  let request;
  const mock = analysis();
  const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', maxCalls: 1, fetchImpl: async (url, options) => {
    request = { url, options }; return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(mock) }] } }] }) };
  } });
  assert.deepEqual(await p.analyze({ message: 'synthetic' }), mock);
  assert.match(request.url, /models\/gemini-3.8-flash:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'synthetic-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.tools, undefined);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  await assert.rejects(p.analyze({}), /local_call_limit/);
});
for (const [status, expected] of [[401, 'auth_error'], [403, 'auth_error'], [404, 'model_unavailable'], [429, 'quota_exhausted'], [500, 'provider_error']]) {
  test(`HTTP ${status}: sanitized failure, no automatic retry`, async () => {
    let calls = 0;
    const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', fetchImpl: async () => { calls++; return { ok: false, status }; } });
    await assert.rejects(p.analyze({}), new RegExp(expected));
    assert.equal(calls, 1);
    if (status !== 500) { await assert.rejects(p.analyze({}), new RegExp(expected)); assert.equal(calls, 1); }
  });
}
for (const [body, expected] of [
  [{ promptFeedback: { blockReason: 'SAFETY' } }, 'provider_refusal'],
  [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'incomplete_output'],
  [{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bad json' }] } }] }, 'invalid_output']
]) test(`adapter handles ${expected}`, async () => {
  const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', fetchImpl: async () => ({ ok: true, json: async () => body }) });
  await assert.rejects(p.analyze({}), new RegExp(expected));
});
test('transcript bound and restart loss are explicit', async () => {
  const app = createAssistant();
  for (let i = 0; i < 20; i++) await app.handle(input('Hello', String(i)));
  assert.ok(app.getState('a').history.length <= 12);
  assert.equal(createAssistant().getState('a'), null);
});
test('omitted and empty text clarify safely, deduplicate and never call provider', async () => {
  let calls = 0;
  const app = createAssistant({ provider: { async analyze() { calls++; throw new Error('must not call'); } } });
  const out = await app.handle({ conversationId: 'missing', messageId: '1' });
  assert.equal(out.nextAction, 'clarify');
  assert.equal(out.state.history[0].text, '');
  const duplicate = await app.handle({ conversationId: 'missing', messageId: '1' });
  assert.equal(duplicate.nextAction, 'duplicate_ignored');
  assert.deepEqual(duplicate.state, out.state);
  assert.equal((await app.handle(input('', '2', 'missing'))).nextAction, 'clarify');
  await assert.rejects(app.handle({ conversationId: 'missing', messageId: '3', text: null }), /text/);
  assert.equal(calls, 0);
});
test('adapter reports sanitized numeric usage without changing analysis response', async () => {
  let usage;
  const raw = analysis();
  const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', fetchImpl: async () => ({ ok: true,
    json: async () => ({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 125,
      thoughtsTokenCount: 5, cachedContentTokenCount: 0, secret: 'must not escape', unknownCount: 9 },
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] }) }) });
  assert.deepEqual(await p.analyze({}, { onUsage: value => { usage = value; } }), raw);
  assert.deepEqual(usage, { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 125, thoughtsTokenCount: 5, cachedContentTokenCount: 0 });
});
test('invalid or missing usage counters are omitted, not estimated as zero', async () => {
  for (const usageMetadata of [undefined, {}, { promptTokenCount: -1, candidatesTokenCount: '20',
    totalTokenCount: Number.MAX_SAFE_INTEGER + 1, thoughtsTokenCount: 1.5 }]) {
    let called = false;
    const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', fetchImpl: async () => ({ ok: true,
      json: async () => ({ usageMetadata, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(analysis()) }] } }] }) }) });
    await p.analyze({}, { onUsage: () => { called = true; } });
    assert.equal(called, false);
  }
});
test('assistant exposes request-local usage, filters unsafe metadata, does not persist it in state', async () => {
  let calls = 0;
  const app = createAssistant({ provider: { async analyze(_, { onUsage }) {
    if (++calls === 1) onUsage({ promptTokenCount: 10, totalTokenCount: 12, key: 'private', thoughtsTokenCount: -1 });
    return analysis();
  } } });
  const a = await app.handle(input());
  assert.deepEqual(a.tokenUsage, { promptTokenCount: 10, totalTokenCount: 12 });
  assert.equal(a.state.tokenUsage, undefined);
  assert.equal((await app.handle(input('math', '2'))).tokenUsage, undefined);
  assert.equal((await app.handle(input('math', '2'))).tokenUsage, undefined);
});
test('usage remains visible on malformed response fallback without applying model facts', async () => {
  const p = createGeminiProvider({ enabled: true, apiKey: 'synthetic-key', fetchImpl: async () => ({ ok: true,
    json: async () => ({ usageMetadata: { totalTokenCount: 50 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'invalid' }] } }] }) }) });
  const out = await createAssistant({ provider: p }).handle(input());
  assert.equal(out.providerStatus, 'invalid_output');
  assert.deepEqual(out.tokenUsage, { totalTokenCount: 50 });
  assert.equal(out.knownFields.class, 7);
});
