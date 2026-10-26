import { validateAnalysis } from './provider-output.js';
import { classify, extract, normalize } from './rules.js';
import { initialState, copyState, validateState, recordEvent } from './state.js';
import { GUARDIAN_FIELDS, QUESTIONS, COMMISSION_REPLY, FORM_REPLY, FALLBACK_REPLY } from './policies.js';

export function processMessage({ conversationId, messageId, text = '', previousState, control, analysis }) {
  if (typeof conversationId !== 'string' || !conversationId.trim() ||
      typeof messageId !== 'string' || !messageId.trim()) throw new Error('Nonempty conversationId and messageId required');
  if (typeof text !== 'string') throw new Error('Message must be text');
  if (control && !['pause', 'takeover', 'resume'].includes(control)) throw new Error('Unknown control');
  const state = previousState ? copyState(previousState) : initialState(conversationId);
  validateState(state, conversationId);
  let policyPrefix = '';
  const result = (nextAction, proposedReply, extractedFields = {}, extra = {}) => ({
    engineMode: 'rules', intent: state.intent, extractedFields,
    knownFields: copyState(state.fields),
    missingFields: state.intent === 'guardian' ? GUARDIAN_FIELDS.filter(f => state.fields[f] === undefined) : [],
    pendingClarifications: [...state.pendingClarifications], nextAction, proposedReply: proposedReply ? policyPrefix + proposedReply : null,
    state: copyState(state), ...extra
  });
  if (state.processedMessageIds.includes(messageId)) return result('duplicate_ignored', null);
  state.processedMessageIds.push(messageId);
  state.version++;
  recordEvent(state, 'message_received', { messageId });
  if (control) {
    state.mode = control === 'resume' ? 'active' : control === 'pause' ? 'paused' : 'human_active';
    recordEvent(state, 'mode_changed', { messageId, mode: state.mode });
    return result(control === 'resume' ? 'resumed' : 'paused', null);
  }
  if (state.mode !== 'active') return result('automation_paused', null);
  const safeHandoff = (reason) => {
    state.mode = 'human_active';
    recordEvent(state, 'handoff', { messageId, reason });
    return result('human_handoff', 'এই বিষয়ে মানুষের সহায়তা প্রয়োজন। অনুগ্রহ করে অপেক্ষা করুন।', {}, { reason });
  };
  if (text.length > 4000) {
    recordEvent(state, 'error', { messageId, reason: 'message_too_long' });
    return safeHandoff('message_too_long');
  }
  if (!text.trim()) return result('clarify', FALLBACK_REPLY);
  const t = normalize(text);
  if (/human|মানুষ|এজেন্ট|কর্মকর্তা/.test(t)) return safeHandoff('human_requested');
  if (/ignore.*(?:rules|instructions)|system prompt|সব নিয়ম|সব নিয়ম|অন্য.*(?:ফোন|তথ্য)|guarantee|নিশ্চয়তা|নিশ্চয়তা|refund policy|ছাড়|ছাড়/.test(t)) return safeHandoff('unsupported_or_sensitive_request');
  if (analysis) analysis = validateAnalysis(analysis, text);
  const ruleIntent = classify(text);
  let detected = analysis?.intent || ruleIntent;
  if (ruleIntent === 'complaint' || detected === 'complaint') { state.intent = 'complaint'; return safeHandoff('complaint'); }
  if (analysis?.needsHuman || analysis?.policyTopics.includes('unknown')) return safeHandoff('provider_requested_review');
  const commission = ruleIntent === 'policy_question' || analysis?.policyTopics.includes('commission');
  const ruleParsed = extract(text, state.lastQuestion);
  const parsed = analysis
    ? { fields: { ...ruleParsed.fields, ...analysis.extractedFields },
      ambiguities: [...new Set([...ruleParsed.ambiguities.filter(f => !Object.hasOwn(analysis.extractedFields, f)), ...analysis.ambiguousFields])],
      jobId: analysis.jobId || ruleParsed.jobId }
    : ruleParsed;
  for (const field of parsed.ambiguities) delete parsed.fields[field];
  if (commission) {
    recordEvent(state, 'policy_answer', { messageId, policy: 'commission' });
    if (!Object.keys(parsed.fields).length || detected === 'tutor' || state.intent === 'tutor') {
      const out = result('answer_policy', COMMISSION_REPLY);
      out.intent = 'policy_question';
      return out;
    }
    // Explicit guardian language, not merely the presence of fields, establishes role.
    if (detected === 'policy_question') detected = classify(text.replace(/commission|কমিশন/gi, ''));
    if (!['guardian', 'tutor'].includes(detected) && state.intent !== 'guardian') {
      return result('answer_policy', COMMISSION_REPLY);
    }
    policyPrefix = COMMISSION_REPLY + ' ';
  }
  if (detected === 'guardian' && state.intent === 'tutor' || detected === 'tutor' && state.intent === 'guardian') return safeHandoff('role_change_needs_review');
  if (detected === 'guardian' && state.intent === 'guardian' && /নতুন|another|new tuition/.test(t)) return safeHandoff('new_request_needs_separation');
  if (['guardian', 'tutor'].includes(detected)) state.intent = detected;
  if (state.intent === 'tutor') {
    if (parsed.jobId) state.jobId = parsed.jobId;
    if (/এই টিউশন|ওই টিউশন|this tuition|interested|আগ্রহী/.test(t)) {
      if (state.jobId) {
        state.mode = 'human_active';
        recordEvent(state, 'handoff', { messageId, reason: 'job_not_verified' });
      }
      return result(state.jobId ? 'human_handoff' : 'ask_job_id', state.jobId
        ? 'Job ID নোট করা হয়েছে। টিউশনের অবস্থা যাচাইয়ের জন্য মানুষের সহায়তা প্রয়োজন।'
        : 'কোন টিউশনে আগ্রহী? অনুগ্রহ করে Job ID দিন।', {}, { reason: state.jobId ? 'job_not_verified' : undefined });
    }
    if (state.jobId) return safeHandoff('job_not_verified');
    state.mode = 'human_active';
    recordEvent(state, 'handoff', { messageId, reason: 'form_link_not_configured' });
    return result('human_handoff', FORM_REPLY, {}, { reason: 'form_link_not_configured' });
  }
  if (state.intent !== 'guardian') {
    return result('clarify', detected === 'general' ? 'আসসালামু আলাইকুম। আপনি কি টিউটর খুঁজছেন, নাকি টিউটর হিসেবে জানতে চাইছেন?' : FALLBACK_REPLY, {}, { intent: detected });
  }
  // Unknown area names and unsupported explicit values must not silently preserve old facts.
  if (!analysis && /area\s*[:=]|এলাকা\s*[:=]/.test(t) && !parsed.fields.area) parsed.ambiguities.push('area');
  for (const field of parsed.ambiguities) {
    if (!state.pendingClarifications.includes(field)) state.pendingClarifications.push(field);
  }
  for (const [field, value] of Object.entries(parsed.fields)) {
    state.fields[field] = value;
    state.sources[field] = messageId;
    state.pendingClarifications = state.pendingClarifications.filter(f => f !== field);
  }
  recordEvent(state, 'fields_updated', { messageId, fields: Object.keys(parsed.fields) });
  const unresolved = state.pendingClarifications[0];
  if (unresolved) {
    state.lastQuestion = unresolved;
    return result('clarify', `তথ্যটি অস্পষ্ট। ${QUESTIONS[unresolved]}`, parsed.fields);
  }
  const missing = GUARDIAN_FIELDS.filter(f => state.fields[f] === undefined);
  if (!Object.keys(parsed.fields).length && detected !== 'guardian') {
    return result('clarify', 'এই তথ্যটি নিশ্চিতভাবে বুঝতে পারিনি। অনুগ্রহ করে বিষয়টি স্পষ্ট করে বলবেন?');
  }
  if (missing.length) {
    state.lastQuestion = missing[0];
    return result('ask_field', QUESTIONS[missing[0]], parsed.fields);
  }
  state.lastQuestion = null;
  const wasReady = state.events.some(e => e.type === 'ready_for_review');
  recordEvent(state, 'ready_for_review', { messageId });
  return result('ready_for_human_review', 'প্রয়োজনীয় তথ্য নোট করা হয়েছে। মানুষের পর্যালোচনার জন্য প্রস্তুত।', parsed.fields,
    { notification: { type: wasReady ? 'enquiry_updated' : 'enquiry_ready', conversationId, version: state.version, fields: copyState(state.fields) } });
}
