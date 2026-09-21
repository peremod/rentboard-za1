// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Backend lint rules.
 *
 * There was no linter here at all: package.json carried `eslint --fix` but
 * ESLint was never a dependency, so `npm run lint` failed on a missing binary
 * rather than on code quality, and CI ran nothing. The old script also passed
 * `--fix`, which would have rewritten files inside CI and then built whatever
 * came out.
 *
 * This starts from the recommended sets rather than a hand-picked list, with a
 * small number of rules turned down where the default fights the framework
 * instead of finding bugs. Anything switched off below has a reason next to
 * it; the intent is a gate that fails only on things worth stopping for, so
 * that it keeps being taken seriously.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { sourceType: 'module' },
      globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      // NestJS decorators legitimately reference types that are otherwise
      // unused in the emitted JS, and DTO classes are full of them.
      // ignoreRestSiblings matters here: `const { documentPath, ...safe } =
      // request` is how this codebase strips a field it must not return, in
      // verification.service.ts among others. The discarded name is the whole
      // point, so flagging it as unused is noise — and the alternative,
      // renaming to _documentPath, would obscure what is being withheld.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Prisma's generated types surface plenty of `any` at the boundary, and
      // an error here would mean either silencing it everywhere or not
      // adopting the linter at all. Warn so it is visible without blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
