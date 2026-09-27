// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // `*.web.ts(x)` files back static web rendering. The template's
    // `use-color-scheme.web.ts` uses the standard `hasHydrated` flag so the
    // server-rendered value does not mismatch the client. The setState inside
    // the effect *is* the pattern, not an oversight, so opt these files out of
    // the heuristic. See https://react.dev/learn/you-might-not-need-an-effect
    files: ['**/*.web.ts', '**/*.web.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
