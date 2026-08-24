<template>
  <div class="app-shell">
    <LoginView v-if="!authed" @login-success="onLogin" />
    <IdeView
      v-else
      :profiles="profiles"
      :settings="settings"
      :auth="auth"
      @refresh-profiles="loadProfiles"
      @refresh-settings="loadSettings"
      @logout="onLogout"
    />
    <ToastContainer :toasts="toasts" />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ToastContainer from './components/ToastContainer.vue';
import IdeView from './views/IdeView.vue';
import LoginView from './views/LoginView.vue';
import { useToast } from './composables/useToast.js';

const { locale, t } = useI18n();
const { toasts, toast } = useToast();
provide('toast', toast);

const profiles = ref([]);
const settings = ref({});
const authed = ref(false);
const auth = ref({ balance: 0 });

let unsubProfileStatus = null;
let unsubAuthHeartbeat = null;
let unsubAuthLogout = null;

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

async function onLogin(payload) {
  auth.value = { balance: payload?.balance || 0 };
  authed.value = true;
  await loadProfiles();
}

async function onLogout() {
  await window.api.authLogout();
  authed.value = false;
  auth.value = { balance: 0 };
}

onMounted(async () => {
  await loadSettings();

  unsubProfileStatus = window.api.onProfileStatus(({ id, status }) => {
    const profile = profiles.value.find(p => p.id === id);
    if (profile) profile.status = status;
  });

  unsubAuthHeartbeat = window.api.onAuthHeartbeat?.((payload) => {
    if (payload?.loggedIn) auth.value = { balance: payload.balance || 0 };
  });

  unsubAuthLogout = window.api.onAuthForcedLogout?.(() => {
    authed.value = false;
    auth.value = { balance: 0 };
    toast(t('auth.sessionExpired'), 'error');
  });
});

onUnmounted(() => {
  unsubProfileStatus?.();
  unsubAuthHeartbeat?.();
  unsubAuthLogout?.();
});
</script>
