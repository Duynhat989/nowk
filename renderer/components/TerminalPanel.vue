<template>
  <section class="terminal-panel">
    <header class="terminal-bar">
      <div class="terminal-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="terminal-tab"
          :class="{ active: tab.id === activeId, run: tab.running || tab.serverOn }"
          role="tab"
          :aria-selected="tab.id === activeId"
          @click="selectTab(tab.id)"
        >
          <span class="terminal-tab-title">{{ tab.title }}</span>
          <span
            class="terminal-tab-close"
            :title="t('terminal.closeTab')"
            @click.stop="closeTab(tab.id)"
          >×</span>
        </button>
        <button
          type="button"
          class="terminal-tab-add"
          :title="t('terminal.new')"
          :disabled="!root"
          @click="addTab"
        >+</button>
        <span v-if="activeTab?.running || activeTab?.serverOn" class="terminal-run">
          {{ activeTab.serverOn ? t('terminal.started') : t('common.running') }}
        </span>
      </div>
      <div class="terminal-actions">
        <button type="button" class="agent-icon-btn" :title="t('terminal.clear')" @click="clear">
          <svg viewBox="0 0 16 16"><path d="M3 4h10M5 4V3h6v1M5 6v7h6V6"/></svg>
        </button>
        <button type="button" class="agent-icon-btn" :title="t('common.stop')" @click="interrupt">
          <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8"/></svg>
        </button>
        <button type="button" class="agent-icon-btn" :title="t('terminal.hide')" @click="$emit('close')">
          <svg viewBox="0 0 16 16"><path d="M3 8h10"/></svg>
        </button>
      </div>
    </header>

    <div ref="hostsEl" class="terminal-hosts">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :ref="(el) => setHost(tab.id, el)"
        class="xterm-host"
        :class="{ disabled: !root, hidden: tab.id !== activeId }"
        @click="focusTerm(tab.id)"
      />
      <p v-if="!root" class="terminal-need-msg">{{ t('terminal.needFolder') }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps({
  root: { type: String, default: '' },
  projectName: { type: String, default: '' },
});

const emit = defineEmits(['close', 'review']);
const { t } = useI18n();
const hostsEl = ref(null);
const tabs = ref([]);
const activeId = ref('');
const hosts = new Map();
const terms = new Map();
const closing = new Set();
let seq = 0;
let unsub = null;
let observer = null;

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeId.value) || null);

function nextId() {
  seq += 1;
  return `term-${Date.now().toString(36)}-${seq}`;
}

function nextTitle(base, exceptId) {
  const label = base || t('terminal.title');
  const used = tabs.value
    .filter((tab) => tab.id !== exceptId)
    .map((tab) => tab.title);
  if (!used.includes(label)) return label;
  let n = 2;
  while (used.includes(`${label} ${n}`)) n += 1;
  return `${label} ${n}`;
}

function setHost(id, el) {
  if (el) hosts.set(id, el);
  else hosts.delete(id);
}

function getTerm(id) {
  return terms.get(id || activeId.value) || null;
}

function focusTerm(id) {
  if (!props.root) return;
  getTerm(id)?.term?.focus();
}

function fitTerm(id) {
  const entry = getTerm(id);
  if (!entry?.fit || !entry.term) return;
  try {
    entry.fit.fit();
    window.api.resizeTerminal?.({
      id: entry.id,
      cols: entry.term.cols,
      rows: entry.term.rows,
    });
  } catch {
    // layout not ready
  }
}

function theme() {
  return {
    background: '#0b1220',
    foreground: '#d1d5db',
    cursor: '#e5e7eb',
    selectionBackground: '#264f78',
    black: '#1e293b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e5e7eb',
  };
}

async function startSession(id) {
  if (!props.root || !window.api.startTerminalSession) return;
  const entry = getTerm(id);
  const result = await window.api.startTerminalSession({
    id,
    root: props.root,
    cols: entry?.term?.cols || 80,
    rows: entry?.term?.rows || 24,
  });
  const tab = tabs.value.find((item) => item.id === id);
  if (tab && result?.title) {
    const fallback = t('terminal.title');
    if (tab.title === fallback || tab.title.startsWith(`${fallback} `)) {
      tab.title = nextTitle(result.title, id);
    }
  }
  if (result && result.ok === false && result.error) {
    writeChunk(id, `\r\n\x1b[31m${result.error}\x1b[0m\r\n`);
  }
}

async function ensureJobTab(data) {
  const id = data.sessionId;
  if (!id) return;
  const existing = tabs.value.find((tab) => tab.id === id);
  if (existing) {
    existing.title = data.title || existing.title;
    existing.command = data.command || existing.command;
    existing.kind = 'job';
    existing.source = data.source || 'agent';
    selectTab(id);
    if (!terms.has(id)) await mountTerm(id, { job: true });
    return;
  }
  tabs.value.push({
    id,
    title: data.title || t('terminal.byAgent'),
    running: true,
    serverOn: false,
    kind: 'job',
    source: data.source || 'agent',
    command: data.command || '',
  });
  activeId.value = id;
  await mountTerm(id, { job: true });
}

async function mountTerm(id, { job = false } = {}) {
  if (terms.has(id)) return;
  await nextTick();
  const el = hosts.get(id);
  if (!el) return;
  const term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'JetBrains Mono, SF Mono, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.3,
    theme: theme(),
    allowProposedApi: false,
    scrollback: 4000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.onData((data) => {
    if (!props.root) return;
    window.api.writeTerminal({ data, id });
  });
  terms.set(id, { id, term, fit, restartTimer: null, job });
  fitTerm(id);
  if (!job) await startSession(id);
  if (id === activeId.value) focusTerm(id);
}

async function addTab() {
  if (!props.root) return;
  const id = nextId();
  tabs.value.push({
    id,
    title: nextTitle(),
    running: false,
    serverOn: false,
  });
  activeId.value = id;
  await mountTerm(id);
}

function selectTab(id) {
  activeId.value = id;
  nextTick(() => {
    fitTerm(id);
    focusTerm(id);
  });
}

async function closeTab(id) {
  const idx = tabs.value.findIndex((tab) => tab.id === id);
  if (idx < 0) return;
  closing.add(id);
  const entry = terms.get(id);
  clearTimeout(entry?.restartTimer);
  entry?.term?.dispose();
  terms.delete(id);
  hosts.delete(id);
  tabs.value.splice(idx, 1);
  await window.api.stopTerminalSession?.({ id });
  closing.delete(id);
  if (!tabs.value.length) {
    activeId.value = '';
    if (props.root) await addTab();
    return;
  }
  if (activeId.value === id) {
    const next = tabs.value[Math.max(0, idx - 1)];
    selectTab(next.id);
  }
}

function clear() {
  getTerm()?.term?.clear();
}

async function interrupt() {
  await window.api.killTerminal?.({ target: 'int', id: activeId.value });
}

function writeChunk(id, text) {
  const entry = getTerm(id);
  if (!entry?.term || !text) return;
  entry.term.write(String(text).replace(/\n/g, '\r\n'));
}

function tabForEvent(data) {
  return tabs.value.find((tab) => tab.id === data?.sessionId)
    || tabs.value.find((tab) => tab.id === activeId.value)
    || null;
}

function onEvent(data) {
  if (data?.type === 'job-open') {
    ensureJobTab(data);
    return;
  }
  if (data?.type === 'agent-watch') {
    emit('review', {
      command: data.command || '',
      title: data.title || '',
      reason: data.reason || 'error',
      code: data.code,
      log: data.log || '',
    });
    return;
  }
  const tab = tabForEvent(data);
  const id = tab?.id || data?.sessionId || activeId.value;
  if (data?.type === 'session-start') {
    if (data.title && tab && tab.title === t('terminal.title')) {
      tab.title = nextTitle(data.title);
    }
    return;
  }
  if (data?.type === 'start') {
    if (tab) {
      if (data.mode === 'start') tab.serverOn = true;
      else tab.running = true;
    }
    const tag = data.source === 'agent' ? t('terminal.byAgent') : '';
    writeChunk(id, `\r\n\x1b[33m$ ${data.command}${tag ? `  # ${tag}` : ''}\x1b[0m\r\n`);
    return;
  }
  if (data?.type === 'data' && data.chunk) {
    if (data.source === 'session') getTerm(id)?.term?.write(data.chunk);
    else writeChunk(id, data.chunk);
    return;
  }
  if (data?.type === 'ready') {
    if (tab) {
      tab.running = false;
      tab.serverOn = true;
    }
    writeChunk(id, `\r\n\x1b[32m[${t('terminal.started')}]\x1b[0m\r\n`);
    return;
  }
  if (data?.type === 'exit') {
    if (tab) {
      if (data.mode === 'start') tab.serverOn = false;
      else tab.running = false;
    }
    writeChunk(id, `\r\n\x1b[90m[${t('terminal.exit', { code: data.code ?? 1 })}]\x1b[0m\r\n`);
    return;
  }
  if (data?.type === 'error') {
    if (tab) tab.running = false;
    writeChunk(id, `\r\n\x1b[31m${data.error || ''}\x1b[0m\r\n`);
    return;
  }
  if (data?.type === 'session-exit' && props.root && !closing.has(id)) {
    const entry = terms.get(id);
    const tab = tabs.value.find((item) => item.id === id);
    if (!entry || entry.job || tab?.kind === 'job') return;
    entry.crashAt = [...(entry.crashAt || []), Date.now()].filter((t) => Date.now() - t < 8000);
    if (entry.crashAt.length >= 4) {
      writeChunk(id, `\r\n\x1b[31m${t('terminal.shellFailed')}\x1b[0m\r\n`);
      return;
    }
    clearTimeout(entry.restartTimer);
    entry.restartTimer = setTimeout(() => startSession(id), 400);
  }
}

async function resetSessions() {
  const ids = tabs.value.map((tab) => tab.id);
  for (const id of ids) {
    closing.add(id);
    const entry = terms.get(id);
    clearTimeout(entry?.restartTimer);
    entry?.term?.dispose();
    terms.delete(id);
    await window.api.stopTerminalSession?.({ id });
    closing.delete(id);
  }
  tabs.value = [];
  activeId.value = '';
  hosts.clear();
}

watch(() => props.root, async (root) => {
  await resetSessions();
  if (root) await addTab();
});

watch(activeId, (id) => {
  if (!id) return;
  nextTick(() => fitTerm(id));
});

onMounted(async () => {
  unsub = window.api.onTerminalEvent?.(onEvent);
  observer = new ResizeObserver(() => {
    if (activeId.value) fitTerm(activeId.value);
  });
  if (props.root) await addTab();
  if (hostsEl.value) observer.observe(hostsEl.value);
});

onUnmounted(async () => {
  unsub?.();
  observer?.disconnect();
  await resetSessions();
});
</script>
