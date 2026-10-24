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
  if (!state.fields || !state.sources || !Array.isArray(state.events) ||
      !Array.isArray(state.processedMessageIds) || !Array.isArray(state.pendingClarifications) ||
      !Number.isInteger(state.version) || state.version < 0) throw new Error('Invalid state structure');
  for (const field of Object.keys(state.fields)) {
    if (!GUARDIAN_FIELDS.includes(field)) throw new Error('Unknown state field');
    const value = state.fields[field];
    if (['class', 'daysPerWeek', 'salaryBudget'].includes(field)) {
      const max = field === 'class' ? 12 : field === 'daysPerWeek' ? 7 : Infinity;
      if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid numeric state field');
    } else if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid text state field');
  }
}

export function recordEvent(state, type, details = {}) {
  state.events.push({ sequence: state.events.length + 1, type, ...details });
}
