<template>
  <aside class="explorer">
    <div class="explorer-header">
      <span class="explorer-title">{{ projectName || t('ide.noFolder') }}</span>
      <div class="explorer-actions">
        <button type="button" :disabled="!root" :title="t('ide.newFile')" @click="$emit('new-file')">
          <svg viewBox="0 0 16 16"><path d="M3 2h6l4 4v8H3z"/><path d="M9 2v4h4"/><path d="M6 9h4M8 7v4"/></svg>
        </button>
        <button type="button" :disabled="!root" :title="t('ide.newFolder')" @click="$emit('new-folder')">
          <svg viewBox="0 0 16 16"><path d="M2 4h5l1 1h6v8H2z"/><path d="M8 8v4M6 10h4"/></svg>
        </button>
        <button type="button" :disabled="!root" :title="t('ide.refresh')" @click="$emit('refresh')">
          <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 11-1.3-3.4"/><path d="M13 3v3h-3"/></svg>
        </button>
        <button type="button" :disabled="!root" :title="t('ide.collapse')" @click="$emit('collapse')">
          <svg viewBox="0 0 16 16"><path d="M3 5h10M3 8h10M3 11h10"/></svg>
        </button>
        <button type="button" :title="t('ide.hideExplorer')" @click="$emit('hide')">
          <svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg>
        </button>
      </div>
    </div>
    <div class="explorer-body" @contextmenu.prevent="onBlankContext">
      <p v-if="!root" class="explorer-empty">{{ t('ide.openFolderHint') }}</p>
      <p v-else-if="!nodes.length && !draft" class="explorer-empty">{{ t('ide.emptyFolder') }}</p>
      <FileTree
        v-else-if="root"
        :nodes="nodes"
        parent-path=""
        :selected-path="selectedPath"
        :open-dirs="openDirs"
        :children-map="childrenMap"
        :git-status="gitStatus"
        :draft="draft"
        @open="$emit('open', $event)"
        @toggle="$emit('toggle', $event)"
        @context="openMenu"
        @submit-draft="$emit('submit-draft', $event)"
        @cancel-draft="$emit('cancel-draft')"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        class="file-ctx-backdrop"
        @mousedown="closeMenu"
        @contextmenu.prevent="closeMenu"
      >
        <div
          class="file-ctx"
          :style="{ top: `${menu.y}px`, left: `${menu.x}px` }"
          @mousedown.stop
        >
          <button type="button" :disabled="!root" @click="act('new-file')">{{ t('ide.newFile') }}</button>
          <button type="button" :disabled="!root" @click="act('new-folder')">{{ t('ide.newFolder') }}</button>
          <template v-if="menu.node">
            <div class="file-ctx-sep" />
            <button type="button" @click="act('rename')">{{ t('ide.rename') }}</button>
            <button type="button" class="danger" @click="act('delete')">{{ t('ide.delete') }}</button>
          </template>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<script setup>
import { onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import FileTree from './FileTree.vue';

const props = defineProps({
  root: { type: String, default: '' },
  projectName: { type: String, default: '' },
  nodes: { type: Array, default: () => [] },
  selectedPath: { type: String, default: '' },
  openDirs: { type: Object, default: () => ({}) },
  childrenMap: { type: Object, default: () => ({}) },
  gitStatus: { type: Object, default: () => ({}) },
  draft: { type: Object, default: null },
});

const emit = defineEmits([
  'open', 'toggle', 'context', 'menu', 'new-file', 'new-folder',
  'refresh', 'collapse', 'hide', 'submit-draft', 'cancel-draft',
]);

const { t } = useI18n();
const menu = ref(null);

function placeMenu(x, y, node) {
  menu.value = {
    node: node || null,
    x: Math.max(8, Math.min(x, window.innerWidth - 200)),
    y: Math.max(8, Math.min(y, window.innerHeight - 180)),
  };
}

function openMenu(payload) {
  if (!payload?.node) return;
  placeMenu(payload.x, payload.y, payload.node);
}

function onBlankContext(event) {
  if (!props.root) return;
  placeMenu(event.clientX, event.clientY, null);
}

function closeMenu() {
  menu.value = null;
}

function act(action) {
  const node = menu.value?.node || null;
  closeMenu();
  emit('menu', { action, node });
}

function onKeydown(event) {
  if (event.key === 'Escape') closeMenu();
}

window.addEventListener('keydown', onKeydown);
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>
