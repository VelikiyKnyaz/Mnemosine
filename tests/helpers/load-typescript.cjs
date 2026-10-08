const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Pure TypeScript modules only. No dotenv, React Native runtime or network.
function createLoader() {
  const root = path.resolve(__dirname, '../..');
  const cache = new Map();
  function load(filename) {
    const target = path.resolve(root, filename);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Module outside project');
    if (cache.has(target)) return cache.get(target).exports;
    const compiled = { exports: {} };
    cache.set(target, compiled);
    const { outputText } = ts.transpileModule(readFileSync(target, 'utf8'), {
      fileName: target,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    new Function('require', 'module', 'exports', outputText)((specifier) => {
      if (!specifier.startsWith('.')) throw new Error('Only relative pure modules allowed');
      const resolved = path.resolve(path.dirname(target), specifier);
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

module.exports = { createLoader };
