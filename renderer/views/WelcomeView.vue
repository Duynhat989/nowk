<template>
  <section class="welcome-page">
    <div class="welcome-card">
      <div class="welcome-brand">
        <div class="welcome-mark">N</div>
        <div>
          <h1>{{ t('welcome.title') }}</h1>
          <p>{{ t('welcome.slogan') }}</p>
        </div>
      </div>

      <label class="welcome-search">
        <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2"/><path d="M10.5 10.5L14 14"/></svg>
        <input
          v-model="query"
          type="search"
          :placeholder="t('welcome.search')"
          autofocus
        />
      </label>

      <div class="welcome-list-head">
        <strong>{{ t('welcome.recent') }}</strong>
        <span>{{ filtered.length }}</span>
      </div>

      <ul v-if="filtered.length" class="welcome-list">
        <li v-for="item in filtered" :key="item.path">
          <button type="button" class="welcome-item" @click="$emit('open', item)">
            <span class="welcome-item-icon">{{ item.missing ? '!' : '⌘' }}</span>
            <span class="welcome-item-text">
              <strong>{{ item.name }}</strong>
              <small :class="{ missing: item.missing }">{{ item.path }}</small>
            </span>
          </button>
          <button
            type="button"
            class="welcome-item-remove"
            :title="t('welcome.remove')"
            @click.stop="$emit('remove', item)"
          >×</button>
        </li>
      </ul>
      <p v-else class="welcome-empty">{{ query.trim() ? t('welcome.noMatch') : t('welcome.empty') }}</p>

      <button type="button" class="btn btn-primary welcome-open" @click="$emit('pick')">
        {{ t('welcome.openFolder') }}
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  recents: { type: Array, default: () => [] },
});

defineEmits(['open', 'pick', 'remove']);

const { t } = useI18n();
const query = ref('');

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = props.recents || [];
  if (!q) return list;
  return list.filter((item) => (
    String(item.name || '').toLowerCase().includes(q)
    || String(item.path || '').toLowerCase().includes(q)
  ));
});
</script>
