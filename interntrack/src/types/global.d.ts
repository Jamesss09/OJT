/**
 * Ambient declarations for non-code imports.
 *
 * The Expo template imports `src/global.css` for web styling, which has no
 * type information. TypeScript 6 rejects untyped side-effect imports (TS2882),
 * so declare the module shape here.
 */
declare module '*.css';
