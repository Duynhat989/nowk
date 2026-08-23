<template>
  <ul class="file-tree" :class="{ root: depth === 0 }">
    <li v-if="showCreateDraft">
      <div class="file-node draft" :style="{ paddingLeft: `${8 + depth * 12}px` }">
        <span class="caret spacer" />
        <FileIcon :name="draftName || draft.name" :type="draft.type" />
        <input
          ref="draftEl"
          v-model="draftName"
          class="file-draft-input"
          spellcheck="false"
          @keydown.enter.prevent="submitDraft"
          @keydown.escape.prevent="cancelDraft"
          @blur="submitDraft"
        />
      </div>
    </li>
    <li v-for="node in nodes" :key="node.path">
      <div
        v-if="isRenaming(node)"
        class="file-node draft"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
      >
        <span class="caret spacer" />
        <FileIcon :name="draftName || node.name" :type="node.type" :open="Boolean(openDirs[node.path])" />
        <input
          :ref="(el) => setRenameEl(el)"
          v-model="draftName"
          class="file-draft-input"
          spellcheck="false"
          @keydown.enter.prevent="submitDraft"
          @keydown.escape.prevent="cancelDraft"
          @blur="submitDraft"
        />
      </div>
      <button
        v-else
        class="file-node"
        :class="[
          gitClass(node),
          {
            active: selectedPath === node.path,
            dir: node.type === 'dir',
          },
        ]"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        :title="node.path"
        @click="onClick(node)"
        @contextmenu.prevent.stop="$emit('context', { node, x: $event.clientX, y: $event.clientY })"
      >
        <span v-if="node.type === 'dir'" class="caret">{{ openDirs[node.path] ? '▾' : '▸' }}</span>
        <span v-else class="caret spacer" />
        <FileIcon
          :name="node.name"
          :type="node.type"
          :open="Boolean(openDirs[node.path])"
        />
        <span class="file-name">{{ node.name }}</span>
        <span v-if="gitMark(node)" class="git-mark">{{ gitMark(node) }}</span>
      </button>
      <FileTree
        v-if="node.type === 'dir' && openDirs[node.path]"
        :nodes="childrenOf(node)"
        :parent-path="node.path"
        :depth="depth + 1"
        :selected-path="selectedPath"
        :open-dirs="openDirs"
        :children-map="childrenMap"
        :git-status="gitStatus"
        :draft="draft"
        @open="$emit('open', $event)"
        @toggle="$emit('toggle', $event)"
        @context="$emit('context', $event)"
        @submit-draft="$emit('submit-draft', $event)"
        @cancel-draft="$emit('cancel-draft')"
      />
    </li>
  </ul>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import FileIcon from './FileIcon.vue';

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  parentPath: { type: String, default: '' },
  depth: { type: Number, default: 0 },
  selectedPath: { type: String, default: '' },
  openDirs: { type: Object, default: () => ({}) },
  childrenMap: { type: Object, default: () => ({}) },
  gitStatus: { type: Object, default: () => ({}) },
  draft: { type: Object, default: null },
});

const emit = defineEmits(['open', 'toggle', 'context', 'submit-draft', 'cancel-draft']);
const draftEl = ref(null);
const draftName = ref('');
let submitted = false;

const showCreateDraft = computed(() => (
  props.draft?.mode === 'create' && (props.draft.parent || '') === (props.parentPath || '')
));

function isRenaming(node) {
  return props.draft?.mode === 'rename' && props.draft.fromPath === node.path;
}

function setRenameEl(el) {
  if (el && !el.dataset.ready) {
    el.dataset.ready = '1';
    nextTick(() => focusDraft(el));
  }
}

function focusDraft(el) {
  if (!el) return;
  el.focus();
  el.select();
}

watch(() => props.draft, (draft) => {
  submitted = false;
  draftName.value = draft?.name || '';
  if (showCreateDraft.value) nextTick(() => focusDraft(draftEl.value));
}, { immediate: true });

function submitDraft() {
  if (submitted || !props.draft) return;
  const name = draftName.value.trim();
  if (!name || /[\\/]/.test(name)) {
    cancelDraft();
    return;
  }
  submitted = true;
  emit('submit-draft', { ...props.draft, name });
}

function cancelDraft() {
  if (submitted) return;
  submitted = true;
  emit('cancel-draft');
}

function childrenOf(node) {
  return props.childrenMap[node.path] || [];
}

function statusOf(node) {
  if (props.gitStatus[node.path]) return props.gitStatus[node.path];
  if (node.type !== 'dir') return '';
  const prefix = `${node.path}/`;
  const childStatuses = Object.entries(props.gitStatus)
    .filter(([file]) => file.startsWith(prefix))
    .map(([, status]) => status);
  if (childStatuses.includes('M') || childStatuses.includes('A')) return 'M';
  if (childStatuses.includes('U')) return 'U';
  return '';
}

function gitClass(node) {
  const status = statusOf(node);
  if (status === 'M' || status === 'A') return 'git-modified';
  if (status === 'U') return 'git-untracked';
  if (status === 'D') return 'git-deleted';
  return '';
}

function gitMark(node) {
  if (node.type !== 'file') return '';
  return statusOf(node);
}

function onClick(node) {
  if (node.type === 'dir') emit('toggle', node);
  else emit('open', node);
}
</script>
