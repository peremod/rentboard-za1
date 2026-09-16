/**
 * Conventional Commits enforcement — see CONTRIBUTING.md §2.
 * Types/scopes must match the project's git workflow doc.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci'
    ]],
    'scope-enum': [2, 'always', [
      'rooms', 'auth', 'users', 'messages', 'payments', 'screening',
      'passport', 'admin', 'seo', 'api', 'cdn', 'db', 'ci', 'deps', 'release'
    ]]
  }
};
