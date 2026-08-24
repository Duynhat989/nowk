<template>
  <div ref="host" class="md-preview" @click="onClick">
    <div class="md-body" v-html="html" />
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import { renderMarkdown, isHttp, safeHref } from '../utils/renderMarkdown.js';

const props = defineProps({
  source: { type: String, default: '' },
  filePath: { type: String, default: '' },
  projectRoot: { type: String, default: '' },
});

const emit = defineEmits(['open-url', 'open-file']);
const host = ref(null);
const html = ref('');
let seq = 0;

function resolveRel(fromFile, dest) {
  const clean = String(dest || '').split('#')[0].split('?')[0].replace(/\\/g, '/');
  if (!clean || clean.startsWith('/')) return clean.replace(/^\/+/, '');
  const dir = String(fromFile || '').replace(/\\/g, '/').split('/').slice(0, -1);
  const parts = [...dir, ...clean.split('/')];
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

async function fillMedia(rootEl) {
  const token = ++seq;
  const nodes = [...rootEl.querySelectorAll('[data-md-src]')];
  await Promise.all(nodes.map(async (el) => {
    const dest = el.getAttribute('data-md-src');
    if (!dest || !props.projectRoot) return;
    const rel = resolveRel(props.filePath, dest);
    const result = await window.api.readWorkspaceMedia?.({
      root: props.projectRoot,
      relPath: rel,
    });
    if (token !== seq) return;
    if (result?.success && result.dataUrl) {
      el.setAttribute('src', result.dataUrl);
      el.removeAttribute('data-md-src');
    }
  }));
}

async function render() {
  html.value = renderMarkdown(props.source || '');
  await nextTick();
  const body = host.value?.querySelector('.md-body');
  if (body) await fillMedia(body);
}

function onClick(event) {
  const a = event.target.closest?.('a.md-link');
  if (!a) return;
  event.preventDefault();
  const href = safeHref(a.getAttribute('href'));
  if (!href) return;
  if (a.getAttribute('data-kind') === 'url' || isHttp(href) || href.startsWith('mailto:')) {
    if (href.startsWith('mailto:')) {
      window.api.openExternal?.(href);
      return;
    }
    emit('open-url', href);
    return;
  }
  emit('open-file', resolveRel(props.filePath, href));
}

watch(() => [props.source, props.filePath, props.projectRoot], render, { immediate: true, flush: 'post' });
</script>
