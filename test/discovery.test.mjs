import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise the real GitHub discovery boundary with synthetic responses only.
import * as connection from '../src/connection.js';
test('repository discovery paginates authenticated GitHub GETs without forwarding credentials elsewhere', async () => {
  assert.equal(typeof connection.discoverRepositories, 'function');
  const calls = [];
  const repos = await connection.discoverRepositories('fake-token', {fetcher: async (url, options) => {
    calls.push({url,options});
    const page = new URL(url).searchParams.get('page');
    return Response.json(page === '1' ? Array.from({length:100}, (_,i) => ({full_name:`fixture/repo-${i}`,default_branch:'main'})) : [{full_name:'fixture/last',default_branch:'trunk'}]);
  }});
  assert.equal(repos.length, 101);
  assert.equal(calls.length, 2);
  for (const {url,options} of calls) {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(new URL(url).pathname, '/user/repos');
    assert.equal(options.headers.Authorization, 'Bearer fake-token');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  }
});
test('discovery rejects missing/invalid tokens and does not silently accept malformed responses', async () => {
  assert.equal(typeof connection.discoverRepositories, 'function');
  await assert.rejects(connection.discoverRepositories('', {fetcher: () => assert.fail('must not fetch without a token')}));
  await assert.rejects(connection.discoverRepositories('fake', {fetcher: async () => Response.json({}, {status:401})}), /rejected the token/);
  await assert.rejects(connection.discoverRepositories('fake', {fetcher: async () => Response.json({})}), /unexpected/i);
});
test('branch discovery includes every branch and identifies the default without assuming main', async () => {
  assert.equal(typeof connection.discoverBranches, 'function');
  const result = await connection.discoverBranches('fixture/notes', 'fake', {fetcher:async url => Response.json(url.includes('/branches?') ? [{name:'trunk'},{name:'drafts'}] : {default_branch:'trunk'})});
  assert.deepEqual(result, {defaultBranch:'trunk', branches:['trunk','drafts']});
});
