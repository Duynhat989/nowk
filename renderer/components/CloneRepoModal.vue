<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2>{{ t('welcome.cloneTitle') }}</h2>
          <p class="popup-subtitle">{{ t('welcome.cloneHint') }}</p>
        </div>
        <button class="btn-icon" type="button" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span>{{ t('welcome.cloneUrl') }}</span>
          <input v-model="url" type="text" :placeholder="t('welcome.cloneUrlPh')" @input="syncName" />
        </label>

        <label class="field">
          <span>{{ t('welcome.folderName') }}</span>
          <input v-model="name" type="text" :placeholder="t('welcome.folderNamePh')" @input="nameTouched = true" />
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
        <p v-if="error" class="hint-warn">{{ error }}</p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="submit">
          {{ busy ? t('welcome.cloning') : t('welcome.clone') }}
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

const url = ref('');
const name = ref('');
const parent = ref('');
const busy = ref(false);
const error = ref('');
const nameTouched = ref(false);

function folderFromUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\.git$/i, '')
    .split(/[/:]/)
    .filter(Boolean)
    .pop() || '';
}

function syncName() {
  if (!nameTouched.value) name.value = folderFromUrl(url.value);
}

async function pickParent() {
  const result = await window.api.pickProjectParent?.();
  if (result?.success && result.path) parent.value = result.path;
}

async function submit() {
  error.value = '';
  if (!url.value.trim()) {
    error.value = t('welcome.needUrl');
    return;
  }
  if (!parent.value) {
    error.value = t('welcome.needParent');
    return;
  }
  busy.value = true;
  try {
    const result = await window.api.cloneProject({
      url: url.value.trim(),
      parent: parent.value,
      name: name.value.trim(),
    });
    if (!result?.success) {
      error.value = result?.error || t('welcome.cloneFailed');
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
