<template>
  <div class="login-wrapper">
    <div class="bg-shape shape-1"></div>
    <div class="bg-shape shape-2"></div>

    <main class="login-card">
      <div class="card-header">
        <div class="icon-box">
          <img src="../assets/icon.png" alt="" width="36" height="36">
        </div>
        <h1>NowK</h1>
        <p>{{ t('auth.subtitle') }}</p>
      </div>

      <div v-if="view === 'choose'" class="panel">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <button type="button" class="submit-btn" :disabled="isLoading" @click="startNanoSignIn">
          <span v-if="!isLoading" class="btn-content">
            {{ t('auth.continueNano') }}
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </span>
          <span v-else class="btn-content">
            <span class="spin" />
            {{ t('auth.checkingSession') }}
          </span>
        </button>
      </div>

      <div v-else class="panel waiting">
        <div class="wait-banner">
          <span class="spin accent" />
          <div>
            <strong>{{ t('auth.waitingTitle') }}</strong>
            <p class="sub">{{ t('auth.waitingHint') }}</p>
          </div>
        </div>

        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>

        <div class="row-actions">
          <button type="button" class="ghost-btn" @click="goBackFromWaiting">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
            {{ t('auth.back') }}
          </button>
          <button type="button" class="linkish" @click="openSignInUrl(signInUrl)">
            {{ t('auth.openSignInAgain') }}
          </button>
        </div>
      </div>

      <div class="card-footer">
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        <span>{{ t('auth.footer') }}</span>
      </div>
    </main>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const emit = defineEmits(['login-success']);
const { t } = useI18n();

const errorMessage = ref('');
const isLoading = ref(false);
const view = ref('choose');
const sessionToken = ref('');
const signInUrl = ref('');
let pollTimer = null;

function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `nano_${Date.now().toString(36)}_${hex}`;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function openSignInUrl(url) {
  if (!url) return;
  const r = await window.api.openExternal(url);
  if (!r?.success) window.open(url, '_blank', 'noopener,noreferrer');
}

async function finishWithAccessToken(accessToken) {
  errorMessage.value = '';
  isLoading.value = true;
  const result = await window.api.authFinish({ accessToken });
  isLoading.value = false;
  if (result?.success) {
    emit('login-success', { balance: result.balance || 0 });
    view.value = 'choose';
    sessionToken.value = '';
    signInUrl.value = '';
    return;
  }
  errorMessage.value = t('auth.tokenInvalid');
  view.value = 'choose';
  sessionToken.value = '';
  signInUrl.value = '';
}

async function pollOnce() {
  const token = sessionToken.value;
  if (!token) return;
  const data = await window.api.authPoll({ token });
  if (data?.success && data.data?.access_token) {
    stopPolling();
    await finishWithAccessToken(data.data.access_token);
  }
}

async function startNanoSignIn() {
  errorMessage.value = '';
  const token = generateSessionToken();
  sessionToken.value = token;
  try {
    const registered = await window.api.authRegister({ token });
    if (!registered?.success) throw new Error(registered?.message || t('auth.serverUnreachable'));
    signInUrl.value = registered.url;
  } catch (e) {
    errorMessage.value = e.message || t('auth.serverUnreachable');
    sessionToken.value = '';
    return;
  }
  await openSignInUrl(signInUrl.value);
  view.value = 'waiting';
  stopPolling();
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => console.error('poll error', err));
  }, 1500);
}

async function goBackFromWaiting() {
  stopPolling();
  await window.api.authAbandon({ token: sessionToken.value });
  sessionToken.value = '';
  signInUrl.value = '';
  view.value = 'choose';
  errorMessage.value = '';
}

onMounted(async () => {
  isLoading.value = true;
  try {
    const session = await window.api.authSession();
    if (session?.loggedIn) {
      emit('login-success', { balance: session.balance || 0 });
    }
  } finally {
    isLoading.value = false;
  }
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.login-wrapper {
  position: relative;
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ide-bg);
  overflow: hidden;
  padding: 20px;
}

.bg-shape {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  z-index: 0;
}

.shape-1 {
  width: 400px;
  height: 400px;
  background: rgba(56, 189, 248, 0.16);
  top: -10%;
  left: -5%;
}

.shape-2 {
  width: 500px;
  height: 500px;
  background: rgba(56, 189, 248, 0.08);
  bottom: -15%;
  right: -10%;
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 460px;
  background: rgba(22, 22, 24, 0.88);
  backdrop-filter: blur(16px);
  border: 1px solid var(--ide-line);
  border-radius: 24px;
  padding: 40px 32px;
  box-shadow: 0 24px 40px rgba(0, 0, 0, 0.5);
}

.card-header {
  text-align: center;
  margin-bottom: 28px;
}

.icon-box {
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  background: var(--ide-panel);
  border: 1px solid var(--ide-line);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-header h1 {
  margin: 0 0 8px;
  font-size: 28px;
  color: var(--ide-text);
  font-weight: 700;
}

.card-header p {
  margin: 0;
  font-size: 14px;
  color: var(--ide-muted);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wait-banner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--ide-line);
  background: var(--ide-panel);
}

.wait-banner .sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ide-muted);
  line-height: 1.45;
}

.error-text {
  font-size: 13px;
  color: var(--danger);
}

.submit-btn {
  width: 100%;
  background: var(--primary);
  color: #082f49;
  border: none;
  border-radius: 14px;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.btn-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.submit-btn:hover:not(:disabled) {
  filter: brightness(1.05);
}

.submit-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.spin {
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
  flex-shrink: 0;
}

.spin.accent {
  color: var(--primary);
  margin-top: 2px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--ide-line);
  background: var(--ide-panel);
  color: var(--ide-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.linkish {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.card-footer {
  margin-top: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ide-muted);
  font-size: 12px;
}
</style>
