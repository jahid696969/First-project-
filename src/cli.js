import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAssistant } from './assistant.js';
import { createGeminiProvider } from './providers/gemini.js';

const rawArgs = process.argv.slice(2);
const debug = rawArgs.includes('--debug') || rawArgs.includes('--fixtures');
const gemini = rawArgs.includes('--gemini');
const allowed = rawArgs.includes('--allow-api-tests');
const args = rawArgs.filter(a => !['--debug', '--gemini', '--allow-api-tests'].includes(a));
if (gemini && !allowed) throw new Error('Gemini disabled: live synthetic API testing requires separate approval and --allow-api-tests');
const assistant = createAssistant({ provider: gemini ? createGeminiProvider({ enabled: true, apiKey: process.env.GEMINI_API_KEY }) : null });
async function run(input) {
  const output = await assistant.handle(input);
  if (debug) console.log(JSON.stringify(output, null, 2));
  else {
    if (input.text) console.log(`তুমি: ${input.text}`);
    console.log(`সিস্টেম: ${output.proposedReply ?? `[${output.nextAction}]`}`);
    console.log(`[${output.engineMode}${output.providerStatus ? `: ${output.providerStatus}` : ''}]`);
  }
}
if (args[0] === '--fixtures' && args.length === 1) {
  if (gemini) throw new Error('Fixtures never call the live provider');
  const cases = JSON.parse(await readFile(new URL('../fixtures/conversations.json', import.meta.url), 'utf8'));
  for (const example of cases) for (const [i, message] of example.messages.entries()) {
    await run({ conversationId: example.id, messageId: `${example.id}-${i}`, text: message.text });
  }
} else if (args[0] === '--message' && args[1]) {
  await run({ conversationId: 'sample', messageId: 'sample-1', text: args.slice(1).join(' ') });
} else if (args.length) {
  console.error('Usage: npm start [-- --debug] | npm run fixtures | npm start -- --message "synthetic message"');
  process.exitCode = 1;
} else {
  console.log('Synthetic data only. Type plain text or JSON. /pause /takeover /resume /new ID /exit. State is temporary.');
  let conversationId = 'sample', sequence = 0;
  const lines = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });
  for await (const line of lines) {
    const text = line.trim();
    if (text === '/exit') { lines.close(); break; }
    if (!text) continue;
    if (text.startsWith('/new ')) { conversationId = text.slice(5).trim(); continue; }
    try {
      if (text.startsWith('{')) await run(JSON.parse(text));
      else if (['/pause', '/takeover', '/resume'].includes(text)) await run({ conversationId, messageId: `operator-${++sequence}`, control: text.slice(1) });
      else await run({ conversationId, messageId: `local-${++sequence}`, text });
    } catch { console.error('Input error: check IDs, JSON format and operator command.'); }
  }
}
