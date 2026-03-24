/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    browser: false,
    es2022: true,
    node: true,
  },
  rules: {
    // Discourage but don't block `any` — existing JSZip/PowerSync workarounds are accepted
    '@typescript-eslint/no-explicit-any': 'warn',
    // Allow unused vars prefixed with _ (common RN pattern)
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Allow require() in test files and babel configs
    '@typescript-eslint/no-var-requires': 'off',
    // Allow empty catch blocks (pattern used extensively for fire-and-forget)
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'cottix-apps-worker/',
    'supabase/',
    '*.config.js',
    'babel.config.js',
    'metro.config.js',
  ],
};
