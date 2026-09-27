/**
 * Jest configuration.
 *
 * `jest-expo` is the SDK-aware preset: it wires the Babel transform for
 * TypeScript/JSX and mocks native modules, so the same config works for the pure
 * tests in `src/lib` today and the repository/component tests added later.
 *
 * Styled with `StyleSheet.create`, not CSS files — but `src/constants/theme.ts`
 * still imports the template's `global.css` for web font variables, and Jest
 * cannot parse CSS. Stubbed below so a component test can import the theme.
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    // Order matters: `moduleNameMapper` applies the first pattern that matches,
    // and `@/global.css` also matches the alias rule below. The stylesheet stub
    // therefore has to be listed first to win.
    '\\.css$': '<rootDir>/jest/styleMock.js',
    // Mirrors the `@/*` -> `./src/*` alias in tsconfig.json. Without this, any
    // test that imports across folders by alias fails to resolve.
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/types/**'],
};
