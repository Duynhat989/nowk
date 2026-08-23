<template>
  <div class="ide">
    <header class="ide-toolbar">
      <div class="ide-toolbar-left">
        <span class="ide-mark">N</span>
        <div class="ide-project">
          <span class="ide-project-name">{{ projectName || t('ide.noFolder') }}</span>
          <span v-if="runningProfile" class="ide-project-meta">{{ runningProfile.name }}</span>
        </div>
      </div>
      <div class="ide-toolbar-right">
        <template v-if="projectRoot">
        <button
          class="ide-tool"
          type="button"
          :disabled="!activeTab"
          :title="t('ide.saveFile')"
          @click="saveActive"
        >
          <svg viewBox="0 0 16 16"><path d="M3 3h8l2 2v8H3z"/><path d="M5 3v3h5V3M5 10h6"/></svg>
        </button>
        <button
          class="ide-tool"
          :class="{ on: explorerOpen }"
          type="button"
          :title="explorerOpen ? t('ide.hideExplorer') : t('ide.showExplorer')"
          @click="toggleExplorer"
        >
          <svg viewBox="0 0 16 16"><path d="M3 4h4l1 1h5v8H3z"/></svg>
        </button>
        <button
          class="ide-tool"
          :class="{ on: terminalOpen }"
          type="button"
          :title="t('terminal.title')"
          @click="toggleTerminal"
        >
          <svg viewBox="0 0 16 16"><path d="M3 4l3 4-3 4M8 12h5"/></svg>
        </button>
        <button
          class="ide-tool"
          :class="{ on: chatOpen }"
          type="button"
          :title="chatOpen ? t('chat.hide') : t('chat.show')"
          @click="toggleChat"
        >
          <svg viewBox="0 0 16 16"><path d="M3 3h10v7H8l-3 3v-3H3z"/></svg>
        </button>
        </template>
        <span class="ide-tool-sep" />
        <button
          class="ide-tool profile"
          type="button"
          :title="t('ide.profiles')"
          @click="profilePopupOpen = true"
        >
          <svg viewBox="0 0 16 16"><circle cx="8" cy="6" r="2.4"/><path d="M3.5 13c.6-2.2 2.3-3.4 4.5-3.4S12.4 10.8 13 13"/></svg>
          <span>{{ t('ide.profiles') }}</span>
          <i v-if="runningProfile" class="ide-live" />
        </button>
        <button
          class="ide-tool"
          type="button"
          :title="t('ide.settings')"
          @click="settingsOpen = true"
        >
          <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2"/><path d="M8 2.5v1.6M8 11.9v1.6M2.5 8h1.6M11.9 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M4.1 11.9l1.1-1.1M10.8 5.2l1.1-1.1"/></svg>
        </button>
      </div>
    </header>

    <WelcomeView
      v-if="!projectRoot"
      :recents="recents"
      @open="openRecent"
      @pick="pickFolder"
      @remove="removeRecent"
    />

    <div v-else class="ide-body">
      <FileExplorer
        v-show="explorerOpen"
        :root="projectRoot"
        :project-name="projectName"
        :nodes="tree"
        :selected-path="selectedPath"
        :open-dirs="openDirs"
        :children-map="childrenMap"
        :git-status="gitStatus"
        :draft="explorerDraft"
        :style="{ width: `${explorerWidth}px` }"
        @open="openFile"
        @toggle="toggleDir"
        @menu="onExplorerMenu"
        @new-file="createItem('file')"
        @new-folder="createItem('dir')"
        @refresh="reloadExplorer"
        @collapse="collapseAll"
        @hide="toggleExplorer"
        @submit-draft="submitExplorerDraft"
        @cancel-draft="explorerDraft = null"
      />
      <div
        v-show="explorerOpen"
        class="ide-sash-v"
        :title="t('ide.resizePanel')"
        @mousedown="startSideResize('explorer', $event)"
        @dblclick="toggleExplorer"
      />

      <div class="ide-center">
      <section class="ide-main">
        <div v-if="tabs.length" class="ide-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.path"
            class="ide-tab"
            :class="{ active: activePath === tab.path, dirty: tab.dirty }"
            type="button"
            @click="selectTab(tab.path)"
          >
            <span>{{ tab.name }}{{ tab.dirty ? ' •' : '' }}</span>
            <span class="ide-tab-close" @click.stop="closeTab(tab.path)">×</span>
          </button>
        </div>

        <div v-if="activeTab" class="ide-editor-wrap">
          <CodeEditor
            ref="editorRef"
            :key="activeTab.path"
            v-model="activeTab.content"
            :filename="activeTab.name"
            @update:model-value="markDirty"
          />
          <footer class="ide-statusbar">
            <span>{{ activeTab.path }}</span>
            <span>{{ languageLabel(activeTab.name) }}</span>
            <span v-if="activeTab.dirty">{{ t('ide.unsaved') }}</span>
          </footer>
        </div>

        <div v-else class="ide-welcome">
          <div class="ide-welcome-mark">N</div>
          <h1>{{ t('ide.welcomeTitle') }}</h1>
          <p v-if="projectName">{{ projectName }}</p>
        </div>
      </section>

      <div
        v-show="terminalOpen"
        class="ide-sash"
        @mousedown="startResize"
      />
      <TerminalPanel
        v-show="terminalOpen"
        :root="projectRoot"
        :project-name="projectName"
        :style="{ height: terminalOpen ? `${terminalHeight}px` : '0px' }"
        @close="terminalOpen = false"
        @review="onTerminalReview"
      />
      </div>

      <div
        v-show="chatOpen"
        class="ide-sash-v"
        :title="t('ide.resizePanel')"
        @mousedown="startSideResize('chat', $event)"
        @dblclick="toggleChat"
      />
      <AgentChat
        ref="chatRef"
        v-show="chatOpen"
        :project-root="projectRoot"
        :open-file="activeTab ? { path: activeTab.path, lines: (activeTab.content || '').split('\n').length } : null"
        :style="{ width: `${chatWidth}px` }"
        @applied="onAgentApplied"
        @close="toggleChat"
      />
    </div>

    <ProfilePopup
      v-if="profilePopupOpen"
      :profiles="profiles"
      :settings="settings"
      :current-id="runningProfile?.id || ''"
      @close="profilePopupOpen = false"
      @refresh="$emit('refresh-profiles')"
    />

    <SettingsModal
      v-if="settingsOpen"
      :settings="settings"
      @close="settingsOpen = false"
      @refresh="$emit('refresh-settings')"
    />
  </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import CodeEditor from '../components/CodeEditor.vue';
import FileExplorer from '../components/FileExplorer.vue';
import ProfilePopup from '../components/ProfilePopup.vue';
import SettingsModal from '../components/SettingsModal.vue';
import AgentChat from '../components/AgentChat.vue';
import TerminalPanel from '../components/TerminalPanel.vue';
import WelcomeView from './WelcomeView.vue';

const props = defineProps({
  profiles: { type: Array, default: () => [] },
  settings: { type: Object, default: () => ({}) },
});

defineEmits(['refresh-profiles', 'refresh-settings']);

const toast = inject('toast');
const { t } = useI18n();

const profilePopupOpen = ref(false);
const settingsOpen = ref(false);
const explorerOpen = ref(true);
const chatOpen = ref(true);
const explorerWidth = ref(248);
const chatWidth = ref(352);
const terminalOpen = ref(false);
const terminalHeight = ref(220);
let unsubTerminal = null;
let unsubAgent = null;
let unsubWorkspace = null;
let unsubPick = null;
let reloadTimer = null;
let resizing = false;
const editorRef = ref(null);
const chatRef = ref(null);
const projectRoot = ref('');
const projectName = ref('');
const tree = ref([]);
const tabs = ref([]);
const activePath = ref('');
const selectedPath = ref('');
const openDirs = reactive({});
const childrenMap = reactive({});
const gitStatus = reactive({});
const explorerDraft = ref(null);
const recents = ref([]);

const runningProfile = computed(() => props.profiles.find(p => p.status === 'running') || null);
const activeTab = computed(() => tabs.value.find(tab => tab.path === activePath.value) || null);

function languageLabel(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  const map = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript', vue: 'Vue', json: 'JSON',
    css: 'CSS', scss: 'SCSS', html: 'HTML', htm: 'HTML', md: 'Markdown',
    py: 'Python', go: 'Go', rs: 'Rust', xml: 'XML', svg: 'SVG',
  };
  return map[ext] || ext || t('ide.untitled');
}

function parentOf(relPath) {
  if (!relPath) return '';
  const parts = relPath.split('/');
  parts.pop();
  return parts.join('/');
}

function targetDir() {
  if (!selectedPath.value) return '';
  const selected = findNode(selectedPath.value);
  if (selected?.type === 'dir') return selectedPath.value;
  return parentOf(selectedPath.value);
}

function findNode(relPath, nodes = tree.value) {
  for (const node of nodes) {
    if (node.path === relPath) return node;
    if (node.type === 'dir') {
      const child = findNode(relPath, childrenMap[node.path] || []);
      if (child) return child;
    }
  }
  return null;
}

async function loadDir(relPath = '') {
  if (!projectRoot.value) return [];
  const result = await window.api.listWorkspace({
    root: projectRoot.value,
    relPath,
  });
  return result.success ? (result.tree || []) : [];
}

async function loadGitStatus() {
  if (!projectRoot.value) return;
  const result = await window.api.gitStatus({ root: projectRoot.value });
  Object.keys(gitStatus).forEach((key) => { delete gitStatus[key]; });
  Object.assign(gitStatus, result.status || {});
}

function revealPath(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean);
  let acc = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    openDirs[acc] = true;
  }
}

function dropDeletedTabs(relPath) {
  if (!relPath) return;
  tabs.value = tabs.value.filter((tab) => tab.path !== relPath && !tab.path.startsWith(`${relPath}/`));
  if (!tabs.value.some((tab) => tab.path === activePath.value)) {
    activePath.value = tabs.value[0]?.path || '';
    selectedPath.value = activePath.value;
  }
}

function scheduleExplorerReload(relPath = '', paths = []) {
  const list = [...new Set([relPath, ...paths].filter(Boolean))];
  list.forEach((item) => revealPath(item));
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadExplorer();
  }, 160);
}

async function onAgentApplied(applied) {
  for (const op of applied || []) {
    if (op.path) revealPath(op.path);
    if (op.action === 'delete' && op.path) dropDeletedTabs(op.path);
  }
  await reloadExplorer();
  for (const op of applied || []) {
    if (op.action !== 'write') continue;
    const tab = tabs.value.find((item) => item.path === op.path);
    if (!tab) continue;
    const result = await window.api.readWorkspaceFile({
      root: projectRoot.value,
      relPath: op.path,
    });
    if (result.success) {
      tab.content = result.content || '';
      tab.dirty = false;
    }
  }
}

async function reloadExplorer() {
  if (!projectRoot.value) {
    tree.value = [];
    return;
  }
  tree.value = await loadDir('');
  const openPaths = Object.keys(openDirs).filter((path) => openDirs[path]);
  for (const dir of openPaths) {
    childrenMap[dir] = await loadDir(dir);
  }
  await loadGitStatus();
}

async function loadRecents() {
  const result = await window.api.listRecentProjects?.();
  recents.value = result?.recents || [];
}

async function openProject(root, name) {
  projectRoot.value = root;
  projectName.value = name || root.split(/[/\\]/).pop();
  tabs.value = [];
  activePath.value = '';
  selectedPath.value = '';
  Object.keys(openDirs).forEach((key) => { delete openDirs[key]; });
  Object.keys(childrenMap).forEach((key) => { delete childrenMap[key]; });
  await reloadExplorer();
  await loadRecents();
}

async function openRecent(item) {
  if (!item?.path || item.missing) return;
  const result = await window.api.openProjectFolder({ root: item.path });
  if (result.success) await openProject(result.root, result.name);
  else toast(result.error || t('ide.openFileFailed'), 'error');
}

async function removeRecent(item) {
  const result = await window.api.removeRecentProject({ path: item.path });
  recents.value = result?.recents || recents.value.filter((row) => row.path !== item.path);
}

async function pickFolder() {
  const result = await window.api.pickProjectFolder();
  if (!result?.success) return;
  await openProject(result.root, result.name);
}

async function toggleDir(node) {
  selectedPath.value = node.path;
  if (openDirs[node.path]) {
    openDirs[node.path] = false;
    return;
  }
  childrenMap[node.path] = await loadDir(node.path);
  openDirs[node.path] = true;
}

function collapseAll() {
  Object.keys(openDirs).forEach((key) => { delete openDirs[key]; });
}

async function openFile(node) {
  if (!node || node.type !== 'file' || !projectRoot.value) return;
  selectedPath.value = node.path;
  const existing = tabs.value.find(tab => tab.path === node.path);
  if (existing) {
    activePath.value = node.path;
    return;
  }
  const result = await window.api.readWorkspaceFile({
    root: projectRoot.value,
    relPath: node.path,
  });
  if (!result.success) {
    toast(result.error || t('ide.openFileFailed'), 'error');
    return;
  }
  tabs.value.push({
    path: node.path,
    name: node.name,
    content: result.content || '',
    dirty: false,
  });
  activePath.value = node.path;
}

function selectTab(path) {
  activePath.value = path;
  selectedPath.value = path;
}

function markDirty() {
  const tab = activeTab.value;
  if (tab) tab.dirty = true;
}

async function saveActive() {
  const tab = activeTab.value;
  if (!tab || !projectRoot.value) return;
  await editorRef.value?.format?.();
  const result = await window.api.writeWorkspaceFile({
    root: projectRoot.value,
    relPath: tab.path,
    content: tab.content,
  });
  if (result.success) {
    tab.dirty = false;
    toast(t('ide.saved'));
    await loadGitStatus();
  } else {
    toast(result.error || t('ide.saveFailed'), 'error');
  }
}

function closeTab(path) {
  const tab = tabs.value.find(item => item.path === path);
  if (tab?.dirty && !confirm(`${tab.name} — ${t('ide.unsaved')}`)) return;
  tabs.value = tabs.value.filter(item => item.path !== path);
  if (activePath.value === path) {
    activePath.value = tabs.value[tabs.value.length - 1]?.path || '';
    selectedPath.value = activePath.value;
  }
}

async function beginCreateDraft(type) {
  if (!projectRoot.value) return;
  const parent = targetDir();
  if (parent) {
    childrenMap[parent] = await loadDir(parent);
    openDirs[parent] = true;
  }
  explorerDraft.value = {
    mode: 'create',
    type,
    parent,
    name: type === 'file' ? 'untitled' : 'folder',
  };
}

async function createItem(type, givenName) {
  if (!projectRoot.value) return;
  if (!givenName) {
    await beginCreateDraft(type);
    return;
  }
  const name = String(givenName).trim();
  if (!name || /[\\/]/.test(name)) return;
  const parent = explorerDraft.value?.parent ?? targetDir();
  explorerDraft.value = null;
  const relPath = [parent, name].filter(Boolean).join('/');
  const result = await window.api.createWorkspaceItem({
    root: projectRoot.value,
    relPath,
    type,
  });
  if (!result.success) {
    toast(result.error || t('ide.saveFailed'), 'error');
    return;
  }
  toast(t('ide.created'));
  if (parent) {
    openDirs[parent] = true;
    childrenMap[parent] = await loadDir(parent);
  }
  await reloadExplorer();
  if (type === 'file') {
    await openFile({ path: relPath, name, type: 'file' });
  }
}

async function deleteItem(node) {
  if (!node?.path || !projectRoot.value) return;
  if (!confirm(t('ide.deleteConfirm', { name: node.name }))) return;
  const result = await window.api.deleteWorkspaceItem({
    root: projectRoot.value,
    relPath: node.path,
  });
  if (result.success) {
    dropDeletedTabs(node.path);
    toast(t('ide.fileDeleted'));
    await reloadExplorer();
  } else {
    toast(result.error || t('ide.saveFailed'), 'error');
  }
}

async function renameItem(node, givenName) {
  if (!node?.path || !projectRoot.value) return;
  if (!givenName) {
    explorerDraft.value = {
      mode: 'rename',
      type: node.type,
      parent: parentOf(node.path),
      name: node.name,
      fromPath: node.path,
    };
    return;
  }
  const nextName = String(givenName).trim();
  if (!nextName || nextName === node.name || /[\\/]/.test(nextName)) {
    explorerDraft.value = null;
    return;
  }
  explorerDraft.value = null;
  const parts = node.path.split('/');
  parts[parts.length - 1] = nextName;
  const toRel = parts.join('/');
  const result = await window.api.renameWorkspaceItem({
    root: projectRoot.value,
    fromRel: node.path,
    toRel,
  });
  if (result.success) {
    const tab = tabs.value.find((item) => item.path === node.path);
    if (tab) {
      tab.path = toRel;
      tab.name = nextName.trim();
      if (activePath.value === node.path) activePath.value = toRel;
    }
    selectedPath.value = toRel;
    toast(t('ide.renamed'));
    await reloadExplorer();
  } else {
    toast(result.error || t('ide.saveFailed'), 'error');
  }
}

function onExplorerMenu({ action, node }) {
  if (node?.path) selectedPath.value = node.path;
  else if (action === 'new-file' || action === 'new-folder') selectedPath.value = '';
  if (action === 'new-file') createItem('file');
  else if (action === 'new-folder') createItem('dir');
  else if (action === 'delete') deleteItem(node);
  else if (action === 'rename') renameItem(node);
}

async function submitExplorerDraft(draft) {
  if (!draft?.name) {
    explorerDraft.value = null;
    return;
  }
  if (draft.mode === 'rename' && draft.fromPath) {
    const oldName = draft.fromPath.split('/').pop();
    await renameItem({ path: draft.fromPath, name: oldName, type: draft.type }, draft.name);
    return;
  }
  await createItem(draft.type, draft.name);
}

function toggleTerminal() {
  terminalOpen.value = !terminalOpen.value;
}

function toggleExplorer() {
  explorerOpen.value = !explorerOpen.value;
}

function toggleChat() {
  chatOpen.value = !chatOpen.value;
}

function onTerminalReview(payload) {
  terminalOpen.value = true;
  chatOpen.value = true;
  chatRef.value?.reviewFromTerminal?.(payload);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function startSideResize(side, event) {
  event.preventDefault();
  resizing = true;
  document.body.classList.add('ide-resizing');
  const startX = event.clientX;
  const startW = side === 'explorer' ? explorerWidth.value : chatWidth.value;
  const bodyW = event.currentTarget?.parentElement?.clientWidth || window.innerWidth;
  const onMove = (moveEvent) => {
    if (!resizing) return;
    const dx = moveEvent.clientX - startX;
    const other = (side === 'explorer' ? (chatOpen.value ? chatWidth.value : 0) : (explorerOpen.value ? explorerWidth.value : 0));
    const max = Math.max(180, bodyW - other - 320);
    if (side === 'explorer') explorerWidth.value = clamp(startW + dx, 180, max);
    else chatWidth.value = clamp(startW - dx, 260, max);
  };
  const onUp = () => {
    resizing = false;
    document.body.classList.remove('ide-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startResize(event) {
  resizing = true;
  const startY = event.clientY;
  const startH = terminalHeight.value;
  const onMove = (moveEvent) => {
    if (!resizing) return;
    const next = startH - (moveEvent.clientY - startY);
    terminalHeight.value = Math.max(120, Math.min(480, next));
  };
  const onUp = () => {
    resizing = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function onKeydown(event) {
  if (event.key === '`' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    toggleTerminal();
    return;
  }
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveActive();
  }
  if (meta && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    pickFolder();
  }
  if (meta && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    profilePopupOpen.value = true;
  }
}

onMounted(() => {
  loadRecents();
  window.addEventListener('keydown', onKeydown);
  unsubPick = window.api.onPickProjectRequest?.(pickFolder);
  unsubTerminal = window.api.onTerminalEvent?.((data) => {
    if (data?.type === 'start') terminalOpen.value = true;
  });
  unsubAgent = window.api.onAgentProgress?.((data) => {
    if (data?.phase === 'terminal' || /^run_/.test(data?.tool || '')) {
      terminalOpen.value = true;
    }
    if (/^(create_file|edit_file|delete_file|mkdir)$/.test(data?.tool || '')) {
      if (data.tool === 'delete_file') dropDeletedTabs(data.path);
      scheduleExplorerReload(data.path || '');
    }
  });
  unsubWorkspace = window.api.onWorkspaceChanged?.((data) => {
    if (!projectRoot.value || !data?.root) return;
    if (data.root !== projectRoot.value) return;
    if (data.action === 'delete') {
      (data.paths || [data.path]).forEach((item) => dropDeletedTabs(item));
    }
    scheduleExplorerReload(data.path || '', data.paths || []);
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(reloadTimer);
  unsubTerminal?.();
  unsubAgent?.();
  unsubWorkspace?.();
  unsubPick?.();
});
</script>
