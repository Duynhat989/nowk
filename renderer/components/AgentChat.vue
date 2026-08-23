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

    <div v-if="plan.length" class="agent-plan">
      <button type="button" class="agent-plan-toggle" @click="planOpen = !planOpen">
        <span>{{ t('chat.planTitle') }}</span>
        <span class="agent-plan-count">{{ planDone }}/{{ plan.length }}</span>
        <span class="agent-plan-chevron" :class="{ open: planOpen }">▾</span>
      </button>
      <ol v-if="planOpen">
        <li v-for="(item, idx) in plan" :key="idx" :class="item.status">
          <span>{{ item.status === 'completed' ? '✓' : '○' }}</span>
          {{ item.task }}
        </li>
      </ol>
    </div>

    <div ref="listEl" class="agent-messages">
      <div v-if="!timeline.length" class="agent-empty">
        <div class="agent-empty-mark">✦</div>
        <h3>{{ t('chat.emptyTitle') }}</h3>
        <p>{{ t('chat.emptySlogan') }}</p>
      </div>

      <div
        v-for="(block, idx) in timeline"
        :key="block.id"
        class="agent-block"
        :class="block.role"
      >
        <div v-if="block.role === 'user'" class="agent-user">{{ block.text }}</div>

        <div v-else-if="block.role === 'assistant'" class="agent-assistant">{{ block.text }}</div>

        <div v-else-if="block.role === 'activity'" class="agent-activity">
          <button type="button" class="agent-activity-head" @click="toggleActivity(block.id)">
            <span class="agent-activity-title">{{ activityTitle(block, idx === timeline.length - 1) }}</span>
            <span class="agent-activity-chevron" :class="{ open: isOpen(block.id) }">▾</span>
          </button>
          <div v-if="isOpen(block.id)" class="agent-activity-body">
            <template v-for="item in block.items" :key="item.id">
              <div v-if="item.kind === 'thought'" class="agent-thought" :class="{ live: item.live }">
                {{ thoughtLabel(item) }}
              </div>

              <button
                v-else-if="item.kind === 'explore'"
                type="button"
                class="agent-act"
                @click="toggleRow(item.id)"
              >
                <span class="agent-act-verb">{{ item.tool }}</span>
                <span class="agent-act-target">{{ exploreTarget(item) }}</span>
                <span v-if="item.range" class="agent-act-range">{{ item.range }}</span>
              </button>

              <div v-else-if="item.kind === 'command'" class="agent-cmd">
                <div class="agent-cmd-head">
                  <span class="agent-cmd-icon">&gt;_</span>
                  <span class="agent-cmd-title">{{ item.command || item.text }}</span>
                  <span class="agent-cmd-meta">{{ commandMeta(item.command || item.text) }}</span>
                </div>
              </div>

              <button
                v-else-if="item.kind === 'write'"
                type="button"
                class="agent-filepill"
                @click="toggleRow(item.id)"
              >
                <FileIcon :name="baseName(item.path)" type="file" />
                <span class="agent-filepill-name">{{ baseName(item.path) || item.tool }}</span>
                <span class="agent-filepill-verb">{{ item.tool }}</span>
              </button>

              <div v-else-if="item.kind === 'diff'" class="agent-diff">
                <button type="button" class="agent-diff-head" @click="toggleRow(item.id)">
                  <span class="agent-diff-chevron" :class="{ open: isRowOpen(item.id, item.lines?.length <= 24) }">▾</span>
                  <FileIcon :name="baseName(item.path)" type="file" />
                  <span class="agent-diff-name">{{ baseName(item.path) || item.path }}</span>
                  <span v-if="diffStats(item.lines).add" class="agent-diff-add">+{{ diffStats(item.lines).add }}</span>
                  <span v-if="diffStats(item.lines).del" class="agent-diff-del">-{{ diffStats(item.lines).del }}</span>
                </button>
                <pre v-if="isRowOpen(item.id, item.lines?.length <= 24)" class="agent-diff-body"><div
                  v-for="(line, idx) in item.lines"
                  :key="idx"
                  class="agent-diff-line"
                  :class="line.type"
                ><span class="agent-diff-gutter">{{ lineNo(item.lines, idx) }}</span><span class="agent-diff-mark">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span><span>{{ line.text }}</span></div></pre>
              </div>

              <div v-else-if="item.kind === 'check'" class="agent-check" :class="item.ok ? 'ok' : 'bad'">
                <span>{{ item.ok ? '✓' : '!' }}</span>
                <span>{{ item.text }}</span>
                <small v-if="item.path">{{ baseName(item.path) }}</small>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="currentRunning && workingLine" class="agent-now">
      <span class="agent-now-dot" />
      <span class="agent-now-text">{{ workingLine }}</span>
    </div>

    <form class="agent-composer" @submit.prevent="send">
      <div class="agent-composer-box">
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
            class="agent-send agent-send-stop"
            type="button"
            :title="t('chat.stop')"
            @click="stop"
          >
            <span class="agent-send-sq" />
          </button>
          <button
            v-else
            class="agent-send"
            type="submit"
            :disabled="!draft.trim() || Boolean(runningId)"
            :title="t('chat.send')"
          >
            <svg viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
          </button>
        </div>
      </div>
    </form>
  </aside>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import FileIcon from './FileIcon.vue';

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
    working: null,
  };
}

const draft = ref('');
const sessions = ref([createSession()]);
const activeId = ref(sessions.value[0].id);
const listEl = ref(null);
const runningId = ref('');
const expanded = ref(new Set());
const rowState = ref(new Map());
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

const EXPLORE = new Set(['Read', 'Search', 'List', 'Git']);
const COMMAND = new Set(['Run', 'Start', 'Test', 'Build']);
const WRITE = new Set(['Edit', 'Write', 'Delete', 'Mkdir']);

const timeline = computed(() => {
  const out = [];
  let group = null;
  const flush = () => {
    if (group) out.push(group);
    group = null;
  };
  for (const item of messages.value) {
    if (item.role === 'user' || item.role === 'assistant') {
      flush();
      out.push(item);
      continue;
    }
    if (!group) {
      group = { role: 'activity', id: `act-${item.id}`, items: [] };
    }
    group.items.push({ ...item, kind: activityKind(item) });
  }
  const sessionChecks = checks.value || [];
  if (sessionChecks.length) {
    if (!group) group = { role: 'activity', id: 'act-checks', items: [] };
    for (const item of sessionChecks) {
      group.items.push({
        id: item.id,
        kind: 'check',
        ok: item.ok,
        text: item.text,
        path: item.path,
      });
    }
  }
  flush();
  return out;
});

const browserHint = computed(() => {
  const name = browser.value.providerName
    || ({ chatgpt: 'ChatGPT', deepseek: 'DeepSeek', gemini: 'Gemini' }[browser.value.provider] || 'Gemini');
  if (browser.value.ok) return t('chat.llmReady', { name });
  if (!browser.value.chromeOpen) return t('chat.chromeClosed');
  if (!browser.value.llmOpen && !browser.value.geminiOpen) return t('chat.llmClosed', { name });
  return browser.value.error || t('chat.chromeClosed');
});

function activityKind(item) {
  if (item.role === 'status' || item.role === 'step') return 'thought';
  if (item.role === 'diff') return 'diff';
  if (item.role === 'tool') {
    if (COMMAND.has(item.tool)) return 'command';
    if (WRITE.has(item.tool)) return 'write';
    if (EXPLORE.has(item.tool)) return 'explore';
    return 'explore';
  }
  return 'thought';
}

function isOpen(id) {
  return expanded.value.has(id);
}

function toggleActivity(id) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function isRowOpen(id, fallback = true) {
  if (rowState.value.has(id)) return rowState.value.get(id);
  return fallback;
}

function toggleRow(id) {
  const next = new Map(rowState.value);
  next.set(id, !isRowOpen(id, true));
  rowState.value = next;
}

function baseName(path) {
  const text = String(path || '').replace(/\\/g, '/');
  return text.split('/').filter(Boolean).pop() || text;
}

function activityTitle(block, isLast = false) {
  if (currentRunning.value && isLast) return t('chat.details');
  const items = block.items || [];
  const files = new Set();
  let searches = 0;
  let writes = 0;
  let commands = 0;
  for (const item of items) {
    if (item.kind === 'explore' && item.tool === 'Search') searches += 1;
    if (item.path) files.add(item.path);
    if (item.kind === 'write' || item.kind === 'diff') writes += 1;
    if (item.kind === 'command') commands += 1;
  }
  if (files.size === 1 && !searches && !writes && !commands) {
    return t('chat.exploredOne', { name: baseName([...files][0]) });
  }
  if (files.size && searches) return t('chat.exploredSearch', { files: files.size, searches });
  if (files.size && !writes && !commands) return t('chat.explored', { files: files.size });
  if (writes && !commands && files.size) return t('chat.editedFiles', { n: files.size });
  if (commands && !files.size) return t('chat.ranCommands', { n: commands });
  if (files.size) return t('chat.explored', { files: files.size });
  return t('chat.activity');
}

function exploreTarget(item) {
  if (item.tool === 'Search') {
    const query = String(item.query || item.text || '').trim();
    const where = item.path ? ` in ${baseName(item.path)}` : '';
    return query ? `${query}${where}` : (item.path || item.text);
  }
  return baseName(item.path || item.text) || item.text;
}

function commandMeta(command) {
  const token = String(command || '').trim().split(/\s+/)[0] || '';
  return token.replace(/^.*[/\\]/, '').slice(0, 16);
}

function formatWorking(data) {
  if (!data) return '';
  const name = baseName(data.path) || data.path || '';
  const query = String(data.query || '').trim();
  const command = String(data.command || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  switch (data.tool) {
    case 'read_file': return t('chat.workingRead', { name: name || 'file' });
    case 'edit_file': return t('chat.workingEdit', { name: name || 'file' });
    case 'create_file': return t('chat.workingWrite', { name: name || 'file' });
    case 'delete_file': return t('chat.workingDelete', { name: name || 'file' });
    case 'mkdir': return t('chat.workingMkdir', { name: name || 'folder' });
    case 'search_code': return t('chat.workingSearch', { query: query || name || 'code' });
    case 'list_files': return t('chat.workingList', { name: name || '/' });
    case 'git_status':
    case 'git_diff':
    case 'git_log':
      return t('chat.workingGit');
    case 'run_command':
    case 'run_start':
    case 'run_test':
    case 'run_build':
      return t('chat.workingRun', { command: command || name || 'command' });
    default:
      return data.message || t('chat.workingThink');
  }
}

const workingLine = computed(() => formatWorking(current().working));

function thoughtLabel(item) {
  if (item.live) return item.text || t('chat.workingThink');
  if (item.role === 'step' && item.text && !/đang nghĩ|thinking/i.test(item.text)) {
    return item.text;
  }
  const sec = item.sec || 0;
  if (sec >= 3) return t('chat.thoughtFor', { sec });
  return t('chat.thoughtBrief');
}

function diffStats(lines) {
  let add = 0;
  let del = 0;
  for (const line of lines || []) {
    if (line.type === 'add') add += 1;
    if (line.type === 'del') del += 1;
  }
  return { add, del };
}

function lineNo(_lines, idx) {
  return idx + 1;
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

function rangeLabel(start, end) {
  const from = Number(start);
  const to = Number(end);
  if (from > 0 && to > 0) return `L${from}-${to}`;
  if (from > 0) return `L${from}`;
  return '';
}

function push(role, text, extra = {}, session = current()) {
  session.messages.push({ id: nextId++, role, text, at: Date.now(), ...extra });
  if (session.id === activeId.value) scrollBottom();
}

function onProgress(data) {
  const session = data?.sessionId ? targetSession(data.sessionId) : current();
  if (data?.type === 'working') {
    session.working = {
      tool: data.tool || 'think',
      path: data.path || '',
      command: data.command || '',
      query: data.query || '',
      message: data.message || '',
    };
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'status') {
      last.text = formatWorking(session.working);
      last.live = true;
    }
    if (session.id === activeId.value) scrollBottom();
    return;
  }
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
    if (last?.role === 'tool' && last.tool === toolLabel(data.tool) && last.path === (data.path || label)) return;
    if (last?.role === 'status') {
      const sec = Math.max(0, Math.round((Date.now() - (last.at || Date.now())) / 1000));
      last.role = 'step';
      last.sec = sec;
      last.live = false;
    }
    push('tool', label, {
      tool: toolLabel(data.tool),
      path: data.path || '',
      command: data.command || '',
      query: data.query || '',
      range: rangeLabel(data.start, data.end),
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
    if (!session.working || session.working.tool === 'think') {
      session.working = { tool: 'think', message: data.message };
    }
    const list = session.messages;
    const last = list[list.length - 1];
    if (last?.role === 'status') {
      last.text = data.message;
      last.live = true;
    } else {
      push('status', data.message, { live: true }, session);
    }
    if (session.id === activeId.value) scrollBottom();
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
  session.working = { tool: 'think', message: t('chat.thinking') };
  push('status', t('chat.thinking'), { live: true }, session);

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
  session.working = null;
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
