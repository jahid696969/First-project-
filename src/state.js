import { GUARDIAN_FIELDS } from './policies.js';

export function initialState(conversationId) {
  return {
    conversationId, mode: 'active', intent: 'uncertain', fields: {}, sources: {},
    pendingClarifications: [], lastQuestion: null, jobId: null,
    processedMessageIds: [], events: [], version: 0
  };
}

export function copyState(state) { return structuredClone(state); }

export function validateState(state, conversationId) {
  if (!state || state.conversationId !== conversationId) throw new Error('State belongs to another conversation');
  if (!['active', 'paused', 'human_active'].includes(state.mode)) throw new Error('Invalid state mode');
  if (!['guardian', 'tutor', 'general', 'uncertain', 'complaint', 'policy_question'].includes(state.intent)) throw new Error('Invalid intent');
  if (!state.fields || !state.sources || !Array.isArray(state.events) ||
      !Array.isArray(state.processedMessageIds) || !Array.isArray(state.pendingClarifications) ||
      !Number.isInteger(state.version) || state.version < 0) throw new Error('Invalid state structure');
  for (const field of Object.keys(state.fields)) {
    if (!GUARDIAN_FIELDS.includes(field)) throw new Error('Unknown state field');
    const value = state.fields[field];
    if (['class', 'daysPerWeek', 'salaryBudget'].includes(field)) {
      const max = field === 'class' ? 12 : field === 'daysPerWeek' ? 7 : Infinity;
      if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid numeric state field');
    } else if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid text state field');
    if (field === 'medium' && !['English Medium', 'English Version', 'Bangla Medium'].includes(value)) throw new Error('Invalid medium');
    if (field === 'genderPreference' && !['Male', 'Female', 'No preference'].includes(value)) throw new Error('Invalid gender preference');
  }
  if (state.pendingClarifications.some(f => !GUARDIAN_FIELDS.includes(f))) throw new Error('Invalid clarification');
}

export function recordEvent(state, type, details = {}) {
  state.events.push({ sequence: state.events.length + 1, type, ...details });
}
