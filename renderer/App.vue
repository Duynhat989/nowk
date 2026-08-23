<template>
  <div class="app-shell">
    <TitleBar />
    <IdeView
      :profiles="profiles"
      :settings="settings"
      @refresh-profiles="loadProfiles"
      @refresh-settings="loadSettings"
    />
    <ToastContainer :toasts="toasts" />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import TitleBar from './components/TitleBar.vue';
import ToastContainer from './components/ToastContainer.vue';
import IdeView from './views/IdeView.vue';
import { useToast } from './composables/useToast.js';

const { locale } = useI18n();
const { toasts, toast } = useToast();
provide('toast', toast);

const profiles = ref([]);
const settings = ref({});

let unsubProfileStatus = null;

async function loadProfiles() {
  profiles.value = await window.api.listProfiles();
}

async function loadSettings() {
  settings.value = await window.api.getSettings();
  if (settings.value.uiLocale) {
    locale.value = settings.value.uiLocale;
    document.documentElement.lang = settings.value.uiLocale;
  }
}

onMounted(async () => {
  await loadSettings();
  await loadProfiles();

  unsubProfileStatus = window.api.onProfileStatus(({ id, status }) => {
    const profile = profiles.value.find(p => p.id === id);
    if (profile) profile.status = status;
  });
});

onUnmounted(() => {
  unsubProfileStatus?.();
});
</script>
