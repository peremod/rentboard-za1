/**
 * Conventional Commits enforcement — see CONTRIBUTING.md §2.
 * Types/scopes must match the project's git workflow doc.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      // 'revert' is standard Conventional Commits and is already in use here
      // (revert(auth): back to sameSite strict) — it was missing from the list.
      'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore',
      'ci', 'revert'
    ]],
    /**
     * config-conventional's default also bans 'sentence-case' and
     * 'start-case', which rejects any subject opening with a proper noun —
     * 'docs(deploy): Neon setup' and 'docs(auth): Google sign-in setup' both
     * failed on it. This project names Neon, Google, PayFast, ImageKit,
     * Resend and Prisma in subjects constantly, so the rule costs more than
     * it earns. Shouting is still rejected.
     */
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    /**
     * This rule had never actually run: the commitlint job is gated on
     * `pull_request` and this repository had no pull request until now, so
     * every commit to date went in unchecked. Of the last 40 scoped commits
     * on master, only 'auth' was on the old list — 'ssr', 'ui', 'board',
     * 'router', 'home', 'env', 'e2e', 'deploy' and 'build' were all in use
     * and would all have been rejected the moment anyone opened a PR.
     *
     * So the list below is widened to every scope the history actually uses,
     * rather than the other way round: a develop → master promotion is the
     * first PR anyone will open here, and it would have failed on its own
     * commits.
     *
     * Some of these overlap — 'billing'/'payments', 'backend'/'api',
     * 'login'/'auth', 'routes'/'router'. Both halves of each pair are kept
     * because both are in use. Worth consolidating to one of each, but that
     * is a convention decision, not something to settle while unblocking a
     * deploy.
     */
    'scope-enum': [2, 'always', [
      // Domain
      'rooms', 'auth', 'login', 'users', 'tenant', 'landlord', 'messages',
      'payments', 'billing', 'screening', 'passport', 'account', 'admin',
      'board', 'home', 'ads', 'ui', 'i18n', 'seo',
      // Platform and tooling
      'api', 'backend', 'frontend', 'ssr', 'router', 'routes', 'cdn', 'db',
      'env', 'build', 'deploy', 'e2e', 'ci', 'deps', 'release'
    ]]
  }
};
