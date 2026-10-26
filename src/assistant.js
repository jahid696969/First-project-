import { processMessage } from './engine.js';
import { copyState, recordEvent } from './state.js';
import { validateAnalysis } from './provider-output.js';

const errorCodes = new Set(['provider_disabled', 'missing_key', 'unapproved_model', 'local_call_limit', 'local_rate_limit', 'token_budget_exceeded', 'auth_error', 'model_unavailable', 'quota_exhausted', 'service_unavailable', 'invalid_request', 'provider_error', 'provider_refusal', 'incomplete_output', 'invalid_output', 'timeout']);
const usageFields = ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'thoughtsTokenCount', 'cachedContentTokenCount'];

// Each instance owns its sessions. Controls execute immediately; normal messages
// serialize per conversation. A generation counter invalidates in-flight work.
export function createAssistant({ provider = null, timeoutMs = 20000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid timeout');
  const sessions = new Map(), queues = new Map(), generations = new Map();
  const commit = (input, out) => {
    if (out.nextAction !== 'duplicate_ignored') {
      const history = out.state.history || [];
      if (!input.control) {
        history.push({ role: 'user', text: input.text.slice(0, 4000) });
        if (out.proposedReply) history.push({ role: 'assistant_draft', text: out.proposedReply });
      }
      out.state.history = history.slice(-12);
      while (out.state.history.reduce((n, item) => n + item.text.length, 0) > 8000) out.state.history.shift();
      sessions.set(input.conversationId, copyState(out.state));
    }
    return copyState(out);
  };
  async function execute(input) {
    const previousState = sessions.get(input.conversationId);
    const baseline = processMessage({ ...input, previousState });
    // Hard handoffs and control/paused/duplicate/empty inputs never reach provider.
    if (!provider || ['duplicate_ignored', 'automation_paused', 'human_handoff'].includes(baseline.nextAction) || !input.text?.trim()) return commit(input, baseline);
    const generation = generations.get(input.conversationId) || 0;
    const controller = new AbortController();
    let timer, analysis, fallbackReason, tokenUsage, retryAfterMs, httpStatus;
    const started = performance.now();
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => provider.analyze({
          message: input.text,
          context: { intent: previousState?.intent || 'uncertain', fields: previousState?.fields || {},
            pendingClarifications: previousState?.pendingClarifications || [], lastQuestion: previousState?.lastQuestion || null,
            history: previousState?.history || [] }
        }, { signal: controller.signal, onUsage: usage => {
          if (!usage || typeof usage !== 'object') return;
          const safe = Object.fromEntries(usageFields.filter(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0).map(k => [k, usage[k]]));
          if (Object.keys(safe).length) tokenUsage = safe;
        } })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })
      ]);
      analysis = validateAnalysis(raw, input.text);
    } catch (error) {
      fallbackReason = errorCodes.has(error?.message) ? error.message : 'provider_error';
      if (Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs > 0) retryAfterMs = error.retryAfterMs;
      if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599) httpStatus = error.httpStatus;
    } finally { clearTimeout(timer); }
    if ((generations.get(input.conversationId) || 0) !== generation) {
      // Consume the accepted message once without applying stale facts/reply.
      const current = sessions.get(input.conversationId);
      const out = processMessage({ ...input, previousState: { ...current, mode: 'paused' } });
      out.state.mode = current.mode;
      out.nextAction = 'stale_result_discarded';
      if (tokenUsage) out.tokenUsage = tokenUsage;
      recordEvent(out.state, 'provider_result_discarded', { messageId: input.messageId });
      return commit(input, out);
    }
    let out;
    if (fallbackReason === 'provider_refusal') {
      out = processMessage({ ...input, previousState, control: 'takeover' });
      out.nextAction = 'human_handoff';
      out.proposedReply = 'এই বিষয়ে মানুষের সহায়তা প্রয়োজন।';
      out.reason = 'provider_refusal';
    } else out = analysis ? processMessage({ ...input, previousState, analysis }) : baseline;
    out.engineMode = analysis ? 'llm' : 'rules';
    out.provider = ['groq', 'gemini'].includes(provider?.name) ? provider.name : 'mock';
    if (retryAfterMs) out.retryAfterMs = retryAfterMs;
    if (httpStatus) out.httpStatus = httpStatus;
    out.providerStatus = analysis ? 'validated' : fallbackReason;
    out.latencyMs = Math.round(performance.now() - started);
    if (tokenUsage) out.tokenUsage = tokenUsage;
    if (fallbackReason) recordEvent(out.state, 'provider_fallback', { messageId: input.messageId, reason: fallbackReason });
    // Model prose remains a draft. Deterministic policy, readiness and handoff
    // replies override it. Questions stay application-selected to avoid repeats.
    if (analysis && out.nextAction === 'clarify' && !out.pendingClarifications.length && !analysis.policyTopics.length) out.proposedReply = analysis.reply;
    return commit(input, out);
  }
  return {
    getState(id) { return sessions.has(id) ? copyState(sessions.get(id)) : null; },
    async handle(input) {
      // Match the synchronous engine's omitted-text behaviour without accepting null.
      input = { ...input, text: input.text === undefined ? '' : input.text };
      if (input.control) {
        const out = processMessage({ ...input, previousState: sessions.get(input.conversationId) });
        if (out.nextAction !== 'duplicate_ignored') generations.set(input.conversationId, (generations.get(input.conversationId) || 0) + 1);
        return commit(input, out);
      }
      const prior = queues.get(input.conversationId) || Promise.resolve();
      const task = prior.catch(() => {}).then(() => execute(input));
      queues.set(input.conversationId, task);
      try { return await task; } finally { if (queues.get(input.conversationId) === task) queues.delete(input.conversationId); }
    }
  };
}
