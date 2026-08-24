<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal modal-lg settings-modal">
      <div class="modal-header">
        <div>
          <h2>{{ t('setup.title') }}</h2>
          <p class="popup-subtitle">{{ t('setup.subtitle') }}</p>
        </div>
        <button class="btn-icon" type="button" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span>{{ t('setup.language') }}</span>
          <select v-model="form.uiLocale" class="select" @change="onLocaleChange">
            <option v-for="opt in localeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>{{ t('setup.dataFolder') }}</span>
          <p class="hint">{{ t('setup.dataFolderDesc') }}</p>
          <div class="input-group">
            <input v-model="form.dataPath" type="text" readonly :placeholder="t('setup.dataPathPlaceholder')">
            <button class="btn btn-secondary" type="button" @click="pickDataPath">{{ t('common.choose') }}</button>
            <button class="btn btn-ghost" type="button" @click="openDataPath">{{ t('common.open') }}</button>
          </div>
        </label>

        <div class="field">
          <span>{{ t('setup.agentBrain') }}</span>
          <p class="hint">{{ t('setup.agentBrainDesc') }}</p>
          <div class="provider-switch">
            <label class="provider-card" :class="{ active: form.agentProvider === 'gemini' }">
              <input v-model="form.agentProvider" type="radio" value="gemini">
              <strong>Gemini</strong>
              <small>gemini.google.com</small>
            </label>
            <label class="provider-card" :class="{ active: form.agentProvider === 'chatgpt' }">
              <input v-model="form.agentProvider" type="radio" value="chatgpt">
              <strong>ChatGPT</strong>
              <small>chatgpt.com</small>
            </label>
            <label class="provider-card" :class="{ active: form.agentProvider === 'deepseek' }">
              <input v-model="form.agentProvider" type="radio" value="deepseek">
              <strong>DeepSeek</strong>
              <small>chat.deepseek.com</small>
            </label>
          </div>
        </div>

        <label class="field">
          <span>{{ t('setup.startupUrl') }}</span>
          <input v-model="form.defaultStartupUrl" type="url" placeholder="about:blank">
        </label>

        <div class="field">
          <span>{{ t('setup.chrome') }}</span>
          <p class="hint">{{ t('setup.chromeDesc') }}</p>
          <div class="chrome-status">
            <span class="badge" :class="settings.chromeReady ? 'badge-running' : 'badge-idle'">
              {{ settings.chromeReady ? t('setup.chromeReady') : t('setup.chromeNotFound') }}
            </span>
          </div>
          <label class="field">
            <span>{{ t('setup.chromeChannel') }}</span>
            <select v-model="form.chromeChannel" class="select">
              <option
                v-for="ch in settings.channels || []"
                :key="ch.id"
                :value="ch.id"
                :disabled="!ch.available"
              >
                {{ ch.label }}{{ ch.available ? '' : t('common.notInstalled') }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>{{ t('setup.chromePath') }}</span>
            <p class="hint">{{ t('setup.chromePathPlaceholder') }}</p>
            <div class="input-group">
              <input v-model="form.chromePath" type="text" :placeholder="t('setup.chromePathPlaceholder')">
              <button class="btn btn-secondary" type="button" @click="pickChromePath">{{ t('common.choose') }}</button>
            </div>
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" type="button" @click="logout">{{ t('auth.logout') }}</button>
        <button class="btn btn-ghost" type="button" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" type="button" @click="save">{{ t('setup.saveSettings') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { LOCALE_OPTIONS } from '../i18n';

const props = defineProps({
  settings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'refresh', 'logout']);

const toast = inject('toast');
const { t, locale } = useI18n();
const localeOptions = LOCALE_OPTIONS;

const form = reactive({
  uiLocale: 'vi',
  dataPath: '',
  defaultStartupUrl: 'about:blank',
  chromeChannel: 'stable',
  chromePath: '',
  agentProvider: 'gemini',
});

watch(() => props.settings, (s) => {
  form.uiLocale = s.uiLocale || 'vi';
  form.dataPath = s.dataPath || '';
  form.defaultStartupUrl = s.defaultStartupUrl || 'about:blank';
  form.chromeChannel = s.chromeChannel || 'stable';
  form.chromePath = s.chromePath || '';
  form.agentProvider = ['gemini', 'chatgpt', 'deepseek'].includes(s.agentProvider)
    ? s.agentProvider
    : 'gemini';
}, { immediate: true });

function onLocaleChange() {
  locale.value = form.uiLocale;
  document.documentElement.lang = form.uiLocale;
}

async function pickDataPath() {
  const picked = await window.api.pickDataPath();
  if (picked) form.dataPath = picked;
}

async function pickChromePath() {
  const picked = await window.api.pickChromePath();
  if (picked) form.chromePath = picked;
}

async function openDataPath() {
  await window.api.openFolder(form.dataPath || props.settings.profilesRoot);
}

async function logout() {
  emit('logout');
  emit('close');
}

async function save() {
  const result = await window.api.saveSettings({
    uiLocale: form.uiLocale,
    dataPath: form.dataPath,
    defaultStartupUrl: form.defaultStartupUrl,
    chromeChannel: form.chromeChannel,
    chromePath: form.chromePath,
    agentProvider: form.agentProvider,
  });
  if (result.success) {
    toast(t('setup.saved'));
    emit('refresh');
    emit('close');
  } else {
    toast(t('setup.saveError'), 'error');
  }
}
</script>
