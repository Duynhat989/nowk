<template>
  <aside class="agent-chat">
    <div class="agent-tabs" role="tablist">
      <span class="agent-tabs-mark">
        <span class="agent-dot" :class="{ busy: Boolean(runningId) }" />
        <strong>{{ t('chat.title') }}</strong>
      </span>
      <button
        v-for="item in sessions"
        :key="item.id"
        type="button"
        class="agent-tab"
        :class="{ active: item.id === activeId, run: item.id === runningId }"
        role="tab"
        :aria-selected="item.id === activeId"
        @click="selectSession(item.id)"
      >
        <span class="agent-tab-title">{{ item.title || t('chat.sessionUntitled') }}</span>
        <span class="agent-tab-close" :title="t('chat.closeChat')" @click.stop="closeSession(item.id)">×</span>
      </button>
      <button
        type="button"
        class="agent-tab-add"
        :title="t('chat.newChat')"
        @click="reset"
      >+</button>
      <button
        type="button"
        class="agent-tab-add agent-tab-hide"
        :title="t('chat.hide')"
        @click="$emit('close')"
      >
        <svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
      </button>
    </div>

    <div v-if="plan.length || checks.length" class="agent-board">
      <section v-if="plan.length" class="agent-board-block" :class="{ open: planOpen }">
        <button type="button" class="agent-board-toggle" @click="planOpen = !planOpen">
          <strong>{{ t('chat.planTitle') }}</strong>
          <span>{{ planDone }}/{{ plan.length }}</span>
          <span class="agent-board-chevron" :class="{ open: planOpen }">▸</span>
        </button>
        <ol v-if="planOpen">
          <li v-for="(item, idx) in plan" :key="idx" :class="item.status">
            <span class="agent-check-mark">{{ item.status === 'completed' ? '✓' : '○' }}</span>
            {{ item.task }}
          </li>
        </ol>
      </section>
      <section v-if="checks.length" class="agent-board-block">
        <header>
          <strong>{{ t('chat.checksTitle') }}</strong>
        </header>
        <ul>
          <li v-for="item in checks" :key="item.id" :class="item.ok ? 'ok' : 'bad'">
            <span class="agent-check-mark">{{ item.ok ? '✓' : '!' }}</span>
            <div>
              <p>{{ item.text }}</p>
              <small v-if="item.path">{{ item.path }}</small>
              <small v-if="item.extra" class="agent-check-extra">{{ item.extra }}</small>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div ref="listEl" class="agent-messages">
      <div v-if="!messages.length && !plan.length && !checks.length" class="agent-empty">
        <div class="agent-empty-mark">✦</div>
        <h3>{{ t('chat.emptyTitle') }}</h3>
        <p>{{ t('chat.emptySlogan') }}</p>
      </div>
      <div
        v-for="item in messages"
        :key="item.id"
        class="agent-msg"
        :class="item.role"
      >
        <div v-if="item.role === 'tool'" class="agent-tool">
          <span class="agent-tool-kind">{{ item.tool || 'tool' }}</span>
          <span class="agent-tool-target">{{ item.path || item.command || item.query || item.text }}</span>
        </div>
        <div v-else-if="item.role === 'diff'" class="agent-diff">
          <div class="agent-diff-path">{{ item.path }}</div>
          <pre class="agent-diff-body"><div
            v-for="(line, idx) in item.lines"
            :key="idx"
            class="agent-diff-line"
            :class="line.type"
          ><span class="agent-diff-mark">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span><span>{{ line.text }}</span></div></pre>
        </div>
        <template v-else>
          <div class="agent-avatar">{{ avatar(item.role) }}</div>
          <div class="agent-bubble">{{ item.text }}</div>
        </template>
      </div>
    </div>

    <form class="agent-composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        rows="3"
        :placeholder="t('chat.placeholder')"
        :disabled="currentRunning"
        @keydown.enter.exact.prevent="send"
      />
      <div class="agent-composer-bar">
        <span class="agent-hint" :class="{ bad: !browser.ok }">{{ browserHint }}</span>
        <button
          v-if="currentRunning"
          class="btn btn-stop btn-sm"
          type="button"
          @click="stop"
        >
          {{ t('chat.stop') }}
        </button>
        <button v-else class="btn btn-primary btn-sm" type="submit" :disabled="!draft.trim() || Boolean(runningId)">
          {{ t('chat.send') }}
        </button>
      </div>
    </form>
  </aside>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  projectRoot: { type: String, default: '' },
  openFile: { type: Object, default: null },
});

const emit = defineEmits(['applied', 'close']);
const toast = inject('toast');
const { t } = useI18n();
function createSession() {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: '',
    messages: [],
    plan: [],
    planOpen: false,
    checks: [],
  };
}

const draft = ref('');
const sessions = ref([createSession()]);
const activeId = ref(sessions.value[0].id);
const listEl = ref(null);
const runningId = ref('');
const busy = computed(() => Boolean(runningId.value));
const currentRunning = computed(() => runningId.value === activeId.value);

function current() {
  return sessions.value.find((item) => item.id === activeId.value) || sessions.value[0];
}

const messages = computed(() => current().messages);
const plan = computed(() => current().plan);
const checks = computed(() => current().checks);
const planOpen = computed({
  get: () => current().planOpen,
  set: (value) => { current().planOpen = value; },
});
const planDone = computed(() => plan.value.filter((item) => item.status === 'completed').length);
const browser = ref({ ok: false, chromeOpen: false, geminiOpen: false, error: '' });
let nextId = 1;
let unsub = null;
let statusTimer = null;

const browserHint = computed(() => {
  const name = browser.value.providerName
    || ({ chatgpt: 'ChatGPT', deepseek: 'DeepSeek', gemini: 'Gemini' }[browser.value.provider] || 'Gemini');
  if (browser.value.ok) return t('chat.llmReady', { name });
  if (!browser.value.chromeOpen) return t('chat.chromeClosed');
  if (!browser.value.llmOpen && !browser.value.geminiOpen) return t('chat.llmClosed', { name });
  return browser.value.error || t('chat.chromeClosed');
});

function avatar(role) {
  if (role === 'user') return 'You';
  if (role === 'status') return '…';
  if (role === 'step') return '…';
  return 'AI';
}

function toolLabel(type) {
  return ({
    read_file: 'Read',
    edit_file: 'Edit',
    create_file: 'Write',
    delete_file: 'Delete',
    list_files: 'List',
    search_code: 'Search',
    mkdir: 'Mkdir',
    run_command: 'Run',
    run_start: 'Start',
    run_test: 'Test',
    run_build: 'Build',
    git_status: 'Git',
  }[type] || type || 'Tool');
}

function reset() {
  const cur = current();
  if (sessions.value.length === 1 && !cur.title && !cur.messages.length) return;
  const session = createSession();
  sessions.value.push(session);
  if (sessions.value.length > 12) {
    const drop = sessions.value.find((item) => item.id !== runningId.value && item.id !== session.id);
    if (drop) sessions.value = sessions.value.filter((item) => item.id !== drop.id);
  }
  activeId.value = session.id;
  draft.value = '';
}

function selectSession(id) {
  if (id === activeId.value) return;
  activeId.value = id;
}

async function closeSession(id) {
  if (runningId.value === id) await stop();
  const idx = sessions.value.findIndex((item) => item.id === id);
  if (idx < 0) return;
  if (sessions.value.length === 1) {
    sessions.value = [createSession()];
    activeId.value = sessions.value[0].id;
    return;
  }
  sessions.value.splice(idx, 1);
  if (activeId.value === id) {
    activeId.value = sessions.value[Math.max(0, idx - 1)].id;
  }
}

function targetSession(id) {
  return sessions.value.find((item) => item.id === id) || current();
}

function pushCheck({ ok, text, path = '', extra = '', key = '' }, session = current()) {
  const id = key || `c-${nextId}`;
  const existing = key ? session.checks.find((item) => item.key === key) : null;
  if (existing) {
    existing.ok = ok;
    existing.text = text;
    existing.path = path;
    existing.extra = extra;
    return;
  }
  session.checks.push({ id, key, ok, text, path, extra });
  if (session.checks.length > 24) session.checks.shift();
}

function auditLabel(tool, ok) {
  if (!ok) return t('chat.auditFail');
  if (tool === 'create_file') return t('chat.auditCreated');
  if (tool === 'edit_file') return t('chat.auditEdited');
  if (tool === 'delete_file') return t('chat.auditDeleted');
  if (tool === 'mkdir') return t('chat.auditMkdir');
  return t('chat.auditEdited');
}

async function scrollBottom() {
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
}

function push(role, text, extra = {}, session = current()) {
  session.messages.push({ id: nextId++, role, text, ...extra });
  if (session.id === activeId.value) scrollBottom();
}

function onProgress(data) {
  const session = data?.sessionId ? targetSession(data.sessionId) : current();
  if (data?.type === 'plan' && Array.isArray(data.plan)) {
    session.plan = data.plan;
    return;
  }
  if (data?.type === 'audit') {
    pushCheck({
      ok: data.ok !== false,
      text: auditLabel(data.tool, data.ok !== false),
      path: data.path || '',
      extra: data.ok === false ? data.message : '',
      key: `audit:${data.tool || ''}:${data.path || data.message || nextId}`,
    }, session);
    return;
  }
  if (data?.type === 'verify') {
    pushCheck({
      ok: data.ok !== false,
      text: data.ok ? t('chat.verifyOk') : t('chat.verifyFail'),
      extra: (data.missing || []).slice(0, 4).join(' · '),
      key: 'verify',
    }, session);
    return;
  }
  if (data?.type === 'sweep') {
    pushCheck({
      ok: data.ok !== false,
      text: data.ok ? t('chat.sweepOk') : t('chat.sweepFail'),
      extra: (data.leftover || []).slice(0, 4).join('\n'),
      key: 'sweep',
    }, session);
    return;
  }
  if (data?.type === 'tool') {
    const last = session.messages[session.messages.length - 1];
    const label = data.path || data.command || data.query || data.message || '';
    if (last?.role === 'tool' && last.tool === data.tool && last.path === label) return;
    push('tool', label, {
      tool: toolLabel(data.tool),
      path: data.path || '',
      command: data.command || '',
      query: data.query || '',
    }, session);
    return;
  }
  if (data?.type === 'diff' && data.lines?.length) {
    push('diff', '', { path: data.path || data.message, lines: data.lines }, session);
    return;
  }
  if (data?.type === 'step' && data.message) {
    if (/^(list_files|read_file|git_status|search_code|Scan |Đã lập bản đồ|Bỏ qua đọc)/.test(data.message)) {
      return;
    }
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'step' && last.text === data.message) return;
    push('step', data.message, {}, session);
    return;
  }
  if (data?.type === 'status' && data.message) {
    const list = session.messages;
    const last = list[list.length - 1];
    if (last?.role === 'status') last.text = data.message;
    else push('status', data.message, {}, session);
  }
}

async function stop() {
  if (!busy.value) return;
  try {
    await window.api.agentStop?.();
  } catch {
    // main process chưa có handler
  }
}

async function refreshBrowser() {
  if (!window.api.agentStatus) {
    browser.value = { ok: false, chromeOpen: false, geminiOpen: false, error: t('chat.needRestart') };
    return;
  }
  try {
    browser.value = await window.api.agentStatus();
  } catch {
    browser.value = { ok: false, chromeOpen: false, geminiOpen: false, error: t('chat.needRestart') };
  }
}

async function reviewFromTerminal(payload) {
  if (runningId.value || !props.projectRoot) return;
  const command = payload?.command || payload?.title || 'command';
  const reason = payload?.reason === 'close'
    ? t('chat.terminalClosed')
    : t('chat.terminalFailed');
  const log = String(payload?.log || '').trim() || '(empty)';
  const code = payload?.code == null ? '?' : payload.code;
  await sendText(t('chat.terminalReview', { command, reason, code, log: log.slice(-3500) }));
}

async function send() {
  await sendText(draft.value.trim());
}

async function sendText(raw) {
  const text = String(raw || '').trim();
  if (!text || runningId.value) return;
  if (!props.projectRoot) {
    toast(t('chat.needFolder'), 'error');
    return;
  }

  await refreshBrowser();
  if (!browser.value.ok) {
    toast(browser.value.error || t('chat.chromeClosed'), 'error');
    return;
  }

  const session = current();
  if (!session.title) session.title = text.replace(/\s+/g, ' ').slice(0, 28);
  push('user', text, {}, session);
  if (draft.value === text || draft.value.trim() === text) draft.value = '';
  session.plan = [];
  session.planOpen = false;
  session.checks = [];
  runningId.value = session.id;
  push('status', t('chat.thinking'), {}, session);

  let result;
  try {
    result = await window.api.agentChat({
      root: props.projectRoot,
      message: text,
      openFile: props.openFile,
      sessionId: session.id,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    result = {
      success: false,
      error: /No handler registered/i.test(msg) ? t('chat.needRestart') : msg,
    };
  }

  session.messages = session.messages.filter((item) => item.role !== 'status');
  if (result.success) {
    const reply = result.reply || t('chat.done');
    if (result.applied?.length) emit('applied', result.applied);
    push('assistant', reply, {}, session);
  } else if (result.aborted) {
    if (result.applied?.length) emit('applied', result.applied);
    push('status', t('chat.stopped'), {}, session);
  } else {
    push('assistant', result.error || t('chat.failed'), {}, session);
    toast(result.error || t('chat.failed'), 'error');
  }
  runningId.value = '';
  await scrollBottom();
}

defineExpose({ reviewFromTerminal });

onMounted(() => {
  unsub = window.api.onAgentProgress?.(onProgress);
  refreshBrowser();
  statusTimer = setInterval(refreshBrowser, 4000);
});

onUnmounted(() => {
  unsub?.();
  if (statusTimer) clearInterval(statusTimer);
});
</script>
