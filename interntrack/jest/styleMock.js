/**
 * Stand-in for stylesheet imports under Jest.
 *
 * `src/constants/theme.ts` does `import '@/global.css'`, which the Expo template
 * uses to define font CSS variables for web. That import is a no-op on native,
 * but Jest cannot parse CSS and fails the whole suite on it — which meant no
 * component test could import the theme module at all.
 *
 * Empty object, not an empty file: a bare file would still need to resolve as a
 * module, and Babel's interop would hand back `undefined` rather than a usable
 * namespace.
 */
module.exports = {};
