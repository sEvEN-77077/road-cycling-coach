import assert from 'node:assert/strict';
import test from 'node:test';
import { modelFromEnv } from '../src/model.mjs';

test('Hy4 Flash uses the TokenHub Chat Completions contract and leaves generic providers unchanged', async () => {
  const tokenHub = 'https://tokenhub.tencentmaas.com/v1/chat/completions';
  const generic = 'https://provider.example/v1/chat/completions';
  for (const url of [tokenHub, generic]) {
    const model = modelFromEnv({
      COACH_MODEL_URL: url, COACH_MODEL_NAME: 'hy4-flash', COACH_MODEL_KEY: 'fictional-key',
    }, async (target, request) => {
      assert.equal(target, url);
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.authorization, 'Bearer fictional-key');
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'hy4-flash');
      assert.equal(body.messages.at(-1).content, '把接下来七天的安排发给我');
      assert.deepEqual(body.thinking, url === tokenHub ? { type: 'disabled' } : undefined);
      return Response.json({ choices: [{ message: { content: '{"kind":"week"}' } }] });
    });
    assert.deepEqual(await model.intent('把接下来七天的安排发给我'), { kind: 'week' });
  }
});
