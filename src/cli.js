import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { processMessage } from './engine.js';

const args = process.argv.slice(2);
const sessions = new Map();
function run(input) {
  const output = processMessage({ ...input, previousState: sessions.get(input.conversationId) });
  sessions.set(input.conversationId, output.state);
  console.log(JSON.stringify(output, null, 2));
}
if (args[0] === '--fixtures') {
  const cases = JSON.parse(await readFile(new URL('../fixtures/conversations.json', import.meta.url), 'utf8'));
  for (const example of cases) {
    for (const [i, message] of example.messages.entries()) {
      run({ conversationId: example.id, messageId: `${example.id}-${i}`, ...message });
    }
  }
} else if (args[0] === '--message' && args[1]) {
  run({ conversationId: 'sample', messageId: 'sample-1', text: args.slice(1).join(' ') });
} else if (args.length) {
  console.error('Usage: npm start | npm run fixtures | npm start -- --message "synthetic message"');
  process.exitCode = 1;
} else {
  console.log('Synthetic data only. JSON per line: {"conversationId":"a","messageId":"1","text":"টিউটর চাই"}');
  console.log('Operator control: same IDs plus "control":"pause" / "takeover" / "resume". /exit to quit. State is temporary.');
  const lines = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });
  for await (const line of lines) {
    if (line.trim() === '/exit') { lines.close(); break; }
    if (!line.trim()) continue;
    try { run(JSON.parse(line)); }
    catch (error) { console.error(JSON.stringify({ error: error.message })); }
  }
}
