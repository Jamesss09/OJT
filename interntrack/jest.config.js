/**
 * Jest configuration.
 *
 * `jest-expo` is the SDK-aware preset: it wires the Babel transform for
 * TypeScript/JSX and mocks native modules, so the same config works for the pure
 * tests in `src/lib` today and the repository/component tests added later.
 */
module.exports = {
  preset: 'jest-expo',
  // Mirrors the `@/*` -> `./src/*` alias in tsconfig.json. Without this, any
  // test that imports across folders by alias fails to resolve.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/types/**'],
};
