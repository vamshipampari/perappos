module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isTest = api.env('test');
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      '@babel/plugin-transform-async-generator-functions',
      // In Jest's Node VM, native import() throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG.
      // @babel/plugin-transform-modules-commonjs guards its dynamic-import transform behind
      // a file.has("@babel/plugin-proposal-dynamic-import") check. The real plugin sets that
      // flag in its pre() hook. We replicate that here — no extra package required.
      ...(isTest ? [() => ({
        name: '@babel/plugin-proposal-dynamic-import',
        pre() { this.file.set('@babel/plugin-proposal-dynamic-import', true); },
        visitor: {},
      })] : []),
    ],
  };
};
