<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal modal-lg">
      <div class="modal-header">
        <div>
          <h2>{{ t('welcome.newTitle') }}</h2>
          <p class="popup-subtitle">{{ t('welcome.newHint') }}</p>
        </div>
        <button class="btn-icon" type="button" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span>{{ t('welcome.folderName') }}</span>
          <input v-model="name" type="text" :placeholder="t('welcome.folderNamePh')" />
        </label>

        <label class="field">
          <span>{{ t('welcome.saveTo') }}</span>
          <div class="input-group">
            <input :value="parent" type="text" readonly :placeholder="t('welcome.saveToPh')" />
            <button class="btn btn-secondary" type="button" @click="pickParent">
              {{ t('common.choose') }}
            </button>
          </div>
        </label>

        <div class="field">
          <span>{{ t('welcome.kind') }}</span>
          <div class="kind-grid">
            <button
              v-for="item in kinds"
              :key="item.id"
              type="button"
              class="kind-card"
              :class="{ active: kind === item.id }"
              @click="kind = item.id"
            >
              <strong>{{ t(`welcome.kinds.${item.id}.title`) }}</strong>
              <small>{{ t(`welcome.kinds.${item.id}.blurb`) }}</small>
            </button>
          </div>
        </div>

        <p class="hint">{{ t(`welcome.kinds.${kind}.prompt`) }}</p>
        <p v-if="error" class="hint-warn">{{ error }}</p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="submit">
          {{ busy ? t('welcome.creating') : t('welcome.create') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const emit = defineEmits(['close', 'created']);
const { t } = useI18n();

const kinds = [
  { id: 'vue3' },
  { id: 'node' },
  { id: 'electron' },
  { id: 'extension' },
  { id: 'html' },
];

const name = ref('my-app');
const parent = ref('');
const kind = ref('vue3');
const busy = ref(false);
const error = ref('');

async function pickParent() {
  const result = await window.api.pickProjectParent?.();
  if (result?.success && result.path) parent.value = result.path;
}

async function submit() {
  error.value = '';
  const folder = name.value.trim();
  if (!folder) {
    error.value = t('welcome.needName');
    return;
  }
  if (!parent.value) {
    error.value = t('welcome.needParent');
    return;
  }
  busy.value = true;
  try {
    const result = await window.api.createProject({
      parent: parent.value,
      name: folder,
      kind: kind.value,
    });
    if (!result?.success) {
      error.value = result?.error || t('welcome.createFailed');
      return;
    }
    emit('created', result);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const result = await window.api.defaultProjectParent?.();
  if (result?.path) parent.value = result.path;
});
</script>
