import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptState, decryptState } from '../scripts/private-state.mjs';

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const fixture = () => ({ version: 1, account: { initial: 12345, cash: 6789, positions: [], trades: [] }, snapshot: { source: 'synthetic-test-only', holdings: [{ asset: 'TEST', quantity: 4321 }] }, events: [], reviews: [] });

test('private state encrypts and unlocks without clear account fields and uses a fresh IV', async () => {
  const secret = key(), state = fixture();
  const first = await encryptState(state, secret), second = await encryptState(state, secret);
  assert.equal(first.algorithm, 'AES-256-GCM');
  assert.equal(Buffer.from(first.iv, 'base64').length, 12);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await decryptState(first, secret), state);
  assert.deepEqual(await decryptState(second, secret), state);
  assert.deepEqual(Object.keys(first).sort(), ['algorithm', 'ciphertext', 'iv', 'version']);
  assert.ok(!JSON.stringify(first).includes('synthetic-test-only'));
  assert.ok(!JSON.stringify(first).includes(secret));
});

test('private state authenticates the key, nonce, and full ciphertext', async () => {
  const secret = key(), envelope = await encryptState(fixture(), secret);
  await assert.rejects(decryptState(envelope, key()), /Unable to unlock/);
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[ciphertext.length - 1] ^= 1;
  await assert.rejects(decryptState({ ...envelope, ciphertext: ciphertext.toString('base64') }, secret), /Unable to unlock/);
  const iv = Buffer.from(envelope.iv, 'base64');
  iv[0] ^= 1;
  await assert.rejects(decryptState({ ...envelope, iv: iv.toString('base64') }, secret), /Unable to unlock/);
});

test('malformed keys and envelopes fail with generic errors', async () => {
  const secret = key(), envelope = await encryptState(fixture(), secret);
  for (const invalid of ['', 'not-a-key', Buffer.alloc(16).toString('base64'), secret + '\n']) {
    await assert.rejects(encryptState(fixture(), invalid), /32-byte key/);
    await assert.rejects(decryptState(envelope, invalid), /32-byte key/);
  }
  for (const invalid of [null, [], { ...envelope, version: 2 }, { ...envelope, algorithm: 'AES-CBC' }, { ...envelope, iv: '!!!!' }, { ...envelope, iv: Buffer.alloc(16).toString('base64') }, { ...envelope, ciphertext: 'AA==' }]) {
    await assert.rejects(decryptState(invalid, secret), /Invalid/);
  }
  await assert.rejects(encryptState({ version: 2 }, secret), /Invalid private/);
  const circular = { version: 1 }; circular.self = circular;
  await assert.rejects(encryptState(circular, secret), /Invalid private/);
});
