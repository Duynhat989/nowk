<template>
  <section class="welcome-page">
    <div class="welcome-card">
      <div class="welcome-brand">
        <img class="welcome-mark" src="../assets/icon.png" alt="NowK" width="44" height="44">
        <h1>NOWK</h1>
      </div>
      <p class="welcome-links">
        <button type="button" @click="createOpen = true">{{ t('welcome.newProject') }}</button>
        <span>·</span>
        <button type="button" class="link" @click="$emit('settings')">{{ t('ide.settings') }}</button>
      </p>

      <div class="welcome-grid">
        <button type="button" class="welcome-tile" @click="$emit('pick')">
          <svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z"/><path d="M4 7V5h7"/></svg>
          <span>{{ t('welcome.openProject') }}</span>
        </button>
        <button type="button" class="welcome-tile" @click="cloneOpen = true">
          <svg viewBox="0 0 24 24"><path d="M12 4v12"/><path d="M8 12l4 4 4-4"/><path d="M5 19h14"/></svg>
          <span>{{ t('welcome.cloneRepo') }}</span>
        </button>
      </div>

      <div class="welcome-list-head">
        <strong>{{ t('welcome.recent') }}</strong>
        <button
          v-if="recents.length > previewCount"
          type="button"
          class="welcome-viewall"
          @click="showAll = !showAll"
        >
          {{ showAll ? t('welcome.viewLess') : t('welcome.viewAll', { n: recents.length }) }}
        </button>
      </div>

      <ul v-if="visible.length" class="welcome-list">
        <li v-for="item in visible" :key="item.path">
          <button type="button" class="welcome-item" @click="$emit('open', item)">
            <strong>{{ item.name }}</strong>
            <small :class="{ missing: item.missing }">{{ shortPath(item.path) }}</small>
          </button>
          <button
            type="button"
            class="welcome-item-remove"
            :title="t('welcome.remove')"
            @click.stop="$emit('remove', item)"
          >×</button>
        </li>
      </ul>
      <p v-else class="welcome-empty">{{ t('welcome.empty') }}</p>
    </div>

    <NewProjectModal
      v-if="createOpen"
      @close="createOpen = false"
      @created="onCreated"
    />
    <CloneRepoModal
      v-if="cloneOpen"
      @close="cloneOpen = false"
      @created="onCloned"
    />
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import NewProjectModal from '../components/NewProjectModal.vue';
import CloneRepoModal from '../components/CloneRepoModal.vue';

const props = defineProps({
  recents: { type: Array, default: () => [] },
});

const emit = defineEmits(['open', 'pick', 'remove', 'created', 'settings']);

const { t } = useI18n();
const createOpen = ref(false);
const cloneOpen = ref(false);
const showAll = ref(false);
const previewCount = 6;

const visible = computed(() => {
  const list = props.recents || [];
  return showAll.value ? list : list.slice(0, previewCount);
});

function shortPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  return raw.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

function onCreated(result) {
  createOpen.value = false;
  emit('created', result);
}

function onCloned(result) {
  cloneOpen.value = false;
  emit('created', result);
}
</script>
