import {githubRequest, repository} from './core.js';

// Construct pagination URLs ourselves: never follow a Link header to another
// origin with the user's token. Treat a partial/error response as a failed list.
async function pages(path, token, options) {
  const result = [];
  for (let page = 1; ; page++) {
    const rows = await githubRequest(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token, options);
    if (!Array.isArray(rows)) throw new Error('GitHub returned an unexpected repository or branch list.');
    result.push(...rows);
    if (rows.length < 100) return result;
  }
}
export async function discoverRepositories(token, options) {
  if (!token) throw new Error('Enter a read-only GitHub token, or enter a repository manually.');
  const rows = await pages('user/repos?sort=full_name', token, options);
  return [...new Set(rows.map(row => repository(row.full_name)))];
}
export async function discoverBranches(repo, token, options) {
  repo = repository(repo);
  const [metadata, rows] = await Promise.all([
    githubRequest(`repos/${repo}`, token, options),
    pages(`repos/${repo}/branches`, token, options)
  ]);
  if (!metadata.default_branch || rows.some(row => typeof row.name !== 'string' || !row.name)) throw new Error('GitHub returned unexpected branch information.');
  return {defaultBranch:metadata.default_branch, branches:[...new Set(rows.map(row => row.name))]};
}
