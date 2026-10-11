import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeConfig, publishIntake } from '../automation/publicIntake.mjs';

test('tunnel configuration rejects alternate routes, credentials, local URLs and lookalike domains', () => {
  assert.equal(intakeConfig('https://example.trycloudflare.com').endpoint, 'https://example.trycloudflare.com/v1/reports');
  for (const url of ['http://example.trycloudflare.com', 'https://example.trycloudflare.com.evil.com', 'http://127.0.0.1:4174', 'https://user:secret@example.trycloudflare.com', 'https://example.trycloudflare.com/api/status', 'https://example.trycloudflare.com?key=1']) assert.throws(() => intakeConfig(url));
});
test('restart publishes only public routing JSON on main with an optimistic file SHA', async () => {
  const calls = [];
  const execute = async (file, args, options) => {
    calls.push({ file, args, options });
    return JSON.stringify({ sha: 'previous-file', content: Buffer.from('{"schemaVersion":1,"endpoint":""}').toString('base64') });
  };
  await publishIntake('https://example.trycloudflare.com', execute);
  assert.equal(calls.length, 2); assert.equal(calls[1].file, 'gh');
  assert.equal(calls[1].args[1], 'repos/DonghyuckLeeKr/DolphinData/contents/support/diagnostic-intake.json');
  const payload = JSON.parse(calls[1].options.input); assert.equal(payload.sha, 'previous-file'); assert.equal(payload.branch, 'main');
  assert.deepEqual(JSON.parse(Buffer.from(payload.content, 'base64').toString()), intakeConfig('https://example.trycloudflare.com'));
});
