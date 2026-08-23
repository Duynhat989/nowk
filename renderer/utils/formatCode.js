import { prettierParser } from './editorLanguage.js';

let loaded = null;

function plugin(mod) {
  return mod.default || mod;
}

async function loadPrettier() {
  if (loaded) return loaded;
  const [prettier, babel, estree, html, postcss, markdown, typescript] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/typescript'),
  ]);
  loaded = {
    format: prettier.format || prettier.default?.format,
    plugins: [babel, estree, html, postcss, markdown, typescript].map(plugin),
  };
  return loaded;
}

export async function formatCode(source, filename) {
  const parser = prettierParser(filename);
  const text = String(source ?? '');
  if (!parser || !text.trim()) return { ok: false, code: text, error: 'unsupported' };
  try {
    const api = await loadPrettier();
    const code = await api.format(text, {
      parser,
      plugins: api.plugins,
      filepath: filename,
      printWidth: 100,
      tabWidth: 2,
      semi: true,
      singleQuote: true,
      trailingComma: 'es5',
      vueIndentScriptAndStyle: true,
      htmlWhitespaceSensitivity: 'ignore',
    });
    return { ok: true, code };
  } catch (error) {
    return { ok: false, code: text, error: error.message || 'format failed' };
  }
}

export function canFormat(filename) {
  return Boolean(prettierParser(filename));
}
