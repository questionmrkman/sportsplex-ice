import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../src/index.js';

const env = { GITHUB_TOKEN: 'tkn', GITHUB_REPO: 'me/repo', WORKFLOW_FILE: 'pages.yml', GITHUB_REF: 'main' };

test('posts a workflow_dispatch to the right URL with the token and ref', async () => {
  let seen;
  const status = await dispatch(env, async (url, init) => {
    seen = { url, init };
    return new Response(null, { status: 204 });
  });
  assert.equal(status, 204);
  assert.equal(seen.url, 'https://api.github.com/repos/me/repo/actions/workflows/pages.yml/dispatches');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer tkn');
  assert.deepEqual(JSON.parse(seen.init.body), { ref: 'main' });
});

test('accepts the newer 200 response as success', async () => {
  assert.equal(await dispatch(env, async () => new Response('{}', { status: 200 })), 200);
});

test('throws with GitHub\'s status when the dispatch is rejected', async () => {
  await assert.rejects(
    dispatch(env, async () => new Response('Bad credentials', { status: 401 })),
    /401.*Bad credentials/,
  );
});

test('fails clearly when the token secret is missing', async () => {
  await assert.rejects(dispatch({ ...env, GITHUB_TOKEN: undefined }, async () => assert.fail('must not call GitHub')), /GITHUB_TOKEN/);
});
