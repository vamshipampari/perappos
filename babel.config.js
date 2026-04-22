module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isTest = api.env('test');
  const isProd = api.env('production');
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      '@babel/plugin-transform-async-generator-functions',
      // In Jest's Node VM, native import() throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG.
      // @babel/plugin-transform-modules-commonjs guards its dynamic-import transform behind
      // a file.has("@babel/plugin-proposal-dynamic-import") check. Registering a plugin with
      // that name sets the flag and enables the transform — no extra package required.
      ...(isTest ? [() => ({
        name: '@babel/plugin-proposal-dynamic-import',
        pre() { this.file.set('@babel/plugin-proposal-dynamic-import', true); },
        visitor: {},
      })] : []),
      // Strip console.log/debug/info in production builds; keep error + warn for Sentry
      ...(isProd ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
    ],
  };
};
