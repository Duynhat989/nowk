import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { vue } from '@codemirror/lang-vue';

const PARSER = {
  js: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  jsx: 'babel',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
};

export function fileExt(name) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  const index = base.lastIndexOf('.');
  return index >= 0 ? base.slice(index + 1).toLowerCase() : '';
}

export function prettierParser(name) {
  return PARSER[fileExt(name)] || '';
}

export function languageSupport(name) {
  const ext = fileExt(name);
  if (ext === 'vue') return vue();
  if (ext === 'html' || ext === 'htm') return html();
  if (ext === 'css' || ext === 'scss' || ext === 'less') return css();
  if (ext === 'json' || ext === 'jsonc') return json();
  if (ext === 'md' || ext === 'markdown') return markdown();
  if (ext === 'py') return python();
  if (ext === 'svg' || ext === 'xml') return xml();
  if (ext === 'ts' || ext === 'tsx') return javascript({ typescript: true, jsx: ext === 'tsx' });
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx') {
    return javascript({ jsx: ext === 'jsx' });
  }
  return [];
}
