import { GUARDIAN_FIELDS } from './policies.js';
import { normalize, extract } from './rules.js';

const intents = ['guardian', 'tutor', 'general', 'policy_question', 'complaint', 'uncertain'];
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intent', 'extractedFields', 'evidence', 'ambiguousFields', 'policyTopics', 'jobId', 'reply', 'needsHuman', 'reason'],
  properties: {
    intent: { type: 'string', enum: intents },
    extractedFields: { type: 'object', additionalProperties: false, properties: Object.fromEntries(GUARDIAN_FIELDS.map(f => [f,
      ['class', 'daysPerWeek', 'salaryBudget'].includes(f) ? { type: 'integer' } : { type: 'string' }])) },
    evidence: { type: 'object', additionalProperties: false, properties: Object.fromEntries([...GUARDIAN_FIELDS, 'jobId'].map(f => [f, { type: 'string' }])) },
    ambiguousFields: { type: 'array', items: { type: 'string', enum: GUARDIAN_FIELDS } },
    policyTopics: { type: 'array', items: { type: 'string', enum: ['commission', 'unknown'] } },
    jobId: { type: ['string', 'null'] }, reply: { type: 'string' },
    needsHuman: { type: 'boolean' }, reason: { type: ['string', 'null'] }
  }
};
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function fail() { throw new Error('invalid_output'); }
export function validateAnalysis(raw, text) {
  if (!plain(raw)) fail();
  if (Object.keys(raw).some(k => !Object.hasOwn(OUTPUT_SCHEMA.properties, k)) || OUTPUT_SCHEMA.required.some(k => !Object.hasOwn(raw, k))) fail();
  if (!intents.includes(raw.intent) || !plain(raw.extractedFields) || !plain(raw.evidence) || typeof raw.needsHuman !== 'boolean') fail();
  if (typeof raw.reply !== 'string' || !raw.reply.trim() || raw.reply.length > 1200 || !(raw.reason === null || typeof raw.reason === 'string' && raw.reason.length <= 200)) fail();
  for (const [field, value] of Object.entries(raw.extractedFields)) {
    if (!GUARDIAN_FIELDS.includes(field)) fail();
    if (['class', 'daysPerWeek', 'salaryBudget'].includes(field)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > (field === 'class' ? 12 : field === 'daysPerWeek' ? 7 : 10000000)) fail();
    } else if (typeof value !== 'string' || !value.trim() || value.length > 120) fail();
    if (field === 'medium' && !['English Medium', 'English Version', 'Bangla Medium'].includes(value)) fail();
    if (field === 'genderPreference' && !['Male', 'Female', 'No preference'].includes(value)) fail();
    checkEvidence(raw.evidence[field], text);
    const explicit = extract(raw.evidence[field]).fields[field];
    if (explicit !== undefined && explicit !== value) fail();
  }
  for (const key of Object.keys(raw.evidence)) if (![...GUARDIAN_FIELDS, 'jobId'].includes(key)) fail();
  if (!Array.isArray(raw.ambiguousFields) || raw.ambiguousFields.some(f => !GUARDIAN_FIELDS.includes(f) || Object.hasOwn(raw.extractedFields, f))) fail();
  if (!Array.isArray(raw.policyTopics) || raw.policyTopics.some(p => !['commission', 'unknown'].includes(p))) fail();
  if (raw.jobId !== null) {
    if (typeof raw.jobId !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(raw.jobId)) fail();
    checkEvidence(raw.evidence.jobId, text);
    if (!normalize(raw.evidence.jobId).includes(normalize(raw.jobId))) fail();
  }
  // Defense in depth, not a semantic guarantee. All text remains a local draft.
  if (/https?:|www\.|guarantee|নিশ্চিত.*(?:পাবেন|টিউটর)|টিউটর.*পাওয়া গেছে|টিউটর.*পাওয়া গেছে|\bavailable\b|\bverified\b|যাচাইকৃত|\d+\s*%|[০-৯]+\s*%/i.test(raw.reply)) fail();
  return structuredClone(raw);
}
function checkEvidence(value, text) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || !normalize(text).includes(normalize(value))) fail();
}
