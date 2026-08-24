<template>
  <div class="url-pane">
    <div class="url-bar">
      <button type="button" :disabled="!canBack" :title="t('ide.webBack')" @click="goBack">
        <svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg>
      </button>
      <button type="button" :disabled="!canForward" :title="t('ide.webForward')" @click="goForward">
        <svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
      </button>
      <button type="button" :title="t('ide.webReload')" @click="reload">
        <svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 0 1 8.3-3.7L13 6M13 8a5 5 0 0 1-8.3 3.7L3 10M13 3v3h-3M3 13v-3h3"/></svg>
      </button>
      <form class="url-form" @submit.prevent="submit">
        <input v-model="draft" type="text" spellcheck="false" :placeholder="t('ide.openUrl')">
      </form>
      <button type="button" :title="t('ide.openExternal')" @click="openOutside">
        <svg viewBox="0 0 16 16"><path d="M7 3h6v6M13 3L7 9M3 5v8h8"/></svg>
      </button>
    </div>
    <webview
      ref="frame"
      class="url-frame"
      :src="src"
      allowpopups
    />
  </div>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  url: { type: String, default: '' },
});

const emit = defineEmits(['update:url', 'title']);
const { t } = useI18n();
const frame = ref(null);
const draft = ref(props.url || '');
const src = ref(normalizeUrl(props.url));
const canBack = ref(false);
const canForward = ref(false);

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'https://';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function view() {
  return frame.value;
}

function syncNav() {
  const el = view();
  try {
    canBack.value = Boolean(el?.canGoBack?.());
    canForward.value = Boolean(el?.canGoForward?.());
  } catch {
    canBack.value = false;
    canForward.value = false;
  }
}

function onNavigate(event) {
  const next = event?.url || view()?.getURL?.() || src.value;
  draft.value = next;
  emit('update:url', next);
  syncNav();
}

function onTitle(event) {
  const title = event?.title || view()?.getTitle?.();
  if (title) emit('title', title);
}

function bind() {
  const el = view();
  if (!el) return;
  el.addEventListener('did-navigate', onNavigate);
  el.addEventListener('did-navigate-in-page', onNavigate);
  el.addEventListener('page-title-updated', onTitle);
  el.addEventListener('did-stop-loading', syncNav);
}

function unbind() {
  const el = view();
  if (!el) return;
  el.removeEventListener('did-navigate', onNavigate);
  el.removeEventListener('did-navigate-in-page', onNavigate);
  el.removeEventListener('page-title-updated', onTitle);
  el.removeEventListener('did-stop-loading', syncNav);
}

function goBack() {
  view()?.goBack?.();
}

function goForward() {
  view()?.goForward?.();
}

function reload() {
  view()?.reload?.();
}

function submit() {
  const next = normalizeUrl(draft.value);
  src.value = next;
  emit('update:url', next);
}

function openOutside() {
  window.api.openExternal?.(normalizeUrl(draft.value || src.value));
}

watch(() => props.url, (value) => {
  const next = normalizeUrl(value);
  if (next === src.value) return;
  src.value = next;
  draft.value = next;
});

onMounted(async () => {
  await nextTick();
  bind();
});

onUnmounted(unbind);
</script>
