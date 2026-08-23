<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal modal-lg">
      <div class="modal-header">
        <h2>{{ profile ? t('profile.editTitle') : t('profile.createTitle') }}</h2>
        <button class="btn-icon" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          class="tab"
          :class="{ active: activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tabLabels[tab] }}
        </button>
      </div>

      <div class="modal-body">
        <div v-show="activeTab === 'general'" class="tab-panel active">
          <label class="field">
            <span>{{ t('profile.name') }}</span>
            <input v-model="form.name" type="text" :placeholder="t('profile.namePlaceholder')">
          </label>
          <label class="field">
            <span>{{ t('profile.notes') }}</span>
            <textarea v-model="form.notes" rows="2" :placeholder="t('profile.notesPlaceholder')" />
          </label>
          <label class="field">
            <span>{{ t('profile.startupUrl') }}</span>
            <input v-model="form.startupUrl" type="url" placeholder="https://www.google.com">
          </label>
          <label class="field">
            <span>{{ t('profile.fpMode') }}</span>
            <select v-model="form.fpMode" class="select" @change="onFpModeChange">
              <option value="consistent">{{ t('profile.fpModes.consistent') }}</option>
              <option value="native">{{ t('profile.fpModes.native') }}</option>
              <option value="stealth">{{ t('profile.fpModes.stealth') }}</option>
              <option value="custom">{{ t('profile.fpModes.custom') }}</option>
            </select>
          </label>
          <p class="hint fp-mode-hint">{{ fpModeHint }}</p>

          <div v-if="form.fpMode === 'consistent'" class="consistent-fp-fields">
            <label class="field">
              <span>{{ t('profile.seed') }}</span>
              <input :value="fpSeedPreview" type="text" readonly :placeholder="t('profile.seedPlaceholder')">
            </label>
            <div class="field-row">
              <label class="field">
                <span>{{ t('profile.timezoneProxy') }}</span>
                <input v-model="form.consistentTimezone" type="text" placeholder="Asia/Ho_Chi_Minh">
              </label>
              <label class="field">
                <span>{{ t('profile.language') }}</span>
                <input v-model="form.consistentLanguage" type="text" placeholder="vi-VN">
              </label>
            </div>
            <div class="field-row checkbox-row">
              <label class="checkbox-field">
                <input v-model="form.consistentWebRTC" type="checkbox">
                <span>{{ t('profile.blockWebRTC') }}</span>
              </label>
            </div>
            <p class="hint">{{ t('profile.consistentHint') }}</p>
          </div>

          <div class="field-row">
            <button class="btn btn-secondary" type="button" @click="applyConsistent">{{ t('profile.useConsistent') }}</button>
            <button class="btn btn-secondary" type="button" @click="applyNative">{{ t('profile.useNative') }}</button>
            <button class="btn btn-secondary" type="button" @click="applyRandom">{{ t('profile.randomCustom') }}</button>
          </div>
        </div>

        <div v-show="activeTab === 'proxy'" class="tab-panel active">
          <label class="field checkbox-field">
            <input v-model="form.proxyEnabled" type="checkbox">
            <span>{{ t('profile.enableProxy') }}</span>
          </label>
          <div class="field-row">
            <label class="field">
              <span>{{ t('profile.type') }}</span>
              <select v-model="form.proxyType" class="select">
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </label>
            <label class="field">
              <span>{{ t('profile.host') }}</span>
              <input v-model="form.proxyHost" type="text" :placeholder="t('profile.hostPlaceholder')">
            </label>
            <label class="field">
              <span>{{ t('profile.port') }}</span>
              <input v-model="form.proxyPort" type="number" :placeholder="t('profile.portPlaceholder')">
            </label>
          </div>
          <p class="hint">{{ t('profile.proxyHint') }}</p>
          <p v-if="form.proxyEnabled && form.fpMode === 'native'" class="hint hint-warn">{{ t('profile.proxyNativeWarn') }}</p>
          <div class="field-row">
            <label class="field">
              <span>{{ t('profile.username') }}</span>
              <input v-model="form.proxyUser" type="text">
            </label>
            <label class="field">
              <span>{{ t('profile.password') }}</span>
              <input v-model="form.proxyPass" type="password">
            </label>
          </div>
        </div>

        <div v-show="activeTab === 'fingerprint'" class="tab-panel active">
          <div v-if="form.fpMode === 'custom'" class="fp-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="applyRandom">{{ t('profile.randomCustom') }}</button>
          </div>
          <div v-if="form.fpMode === 'custom'">
            <label class="field">
              <span>{{ t('profile.userAgent') }}</span>
              <input v-model="form.userAgent" type="text">
            </label>
            <div class="field-row">
              <label class="field">
                <span>{{ t('profile.screenWh') }}</span>
                <div class="inline-inputs">
                  <input v-model="form.screenW" type="number" placeholder="1920">
                  <span>×</span>
                  <input v-model="form.screenH" type="number" placeholder="1080">
                </div>
              </label>
              <label class="field">
                <span>{{ t('profile.ram') }}</span>
                <input v-model="form.ram" type="number" min="1" max="128">
              </label>
              <label class="field">
                <span>{{ t('profile.cpuCores') }}</span>
                <input v-model="form.cpu" type="number" min="1" max="32">
              </label>
            </div>
            <div class="field-row">
              <label class="field">
                <span>{{ t('profile.timezone') }}</span>
                <input v-model="form.timezone" type="text" placeholder="Asia/Ho_Chi_Minh">
              </label>
              <label class="field">
                <span>{{ t('profile.language') }}</span>
                <input v-model="form.language" type="text" placeholder="en-US">
              </label>
            </div>
            <label class="field">
              <span>{{ t('profile.webglVendor') }}</span>
              <input v-model="form.webglVendor" type="text">
            </label>
            <label class="field">
              <span>{{ t('profile.webglRenderer') }}</span>
              <input v-model="form.webglRenderer" type="text">
            </label>
            <label class="field">
              <span>{{ t('profile.mac') }}</span>
              <input v-model="form.mac" type="text" placeholder="00:1A:2B:3C:4D:5E">
            </label>
            <div class="field-row checkbox-row">
              <label class="checkbox-field">
                <input v-model="form.canvasNoise" type="checkbox">
                <span>{{ t('profile.canvasNoise') }}</span>
              </label>
              <label class="checkbox-field">
                <input v-model="form.disableWebRTC" type="checkbox">
                <span>{{ t('profile.blockWebRTC') }}</span>
              </label>
            </div>
          </div>
          <p v-else class="hint">{{ t('profile.fpManualHint', { mode: form.fpMode }) }}</p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="save">{{ t('profile.saveProfile') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  profile: { type: Object, default: null },
  settings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'saved']);

const toast = inject('toast');
const { t } = useI18n();

const tabs = ['general', 'proxy', 'fingerprint'];
const tabLabels = computed(() => ({
  general: t('profile.tabs.general'),
  proxy: t('profile.tabs.proxy'),
  fingerprint: t('profile.tabs.fingerprint'),
}));
const activeTab = ref('general');

const existingFp = ref({});

const form = reactive({
  name: '',
  notes: '',
  startupUrl: '',
  fpMode: 'consistent',
  consistentTimezone: 'Asia/Ho_Chi_Minh',
  consistentLanguage: 'vi-VN',
  consistentWebRTC: true,
  proxyEnabled: false,
  proxyType: 'http',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
  userAgent: '',
  language: 'vi-VN',
  timezone: 'Asia/Ho_Chi_Minh',
  screenW: '',
  screenH: '',
  ram: '',
  cpu: '',
  webglVendor: '',
  webglRenderer: '',
  mac: '',
  canvasNoise: false,
  disableWebRTC: false,
});

const fpModeHint = computed(() => t('profile.fpHints.' + form.fpMode));

const fpSeedPreview = computed(() => {
  const seed = existingFp.value.profileSeed;
  return seed ? `${seed.slice(0, 8)}…` : '';
});

function fillFromProfile(profile) {
  form.name = profile?.name || '';
  form.notes = profile?.notes || '';
  form.startupUrl = profile?.startupUrl || props.settings.defaultStartupUrl || 'about:blank';

  const proxy = profile?.proxy || {};
  form.proxyEnabled = !!proxy.enabled;
  form.proxyType = proxy.type || 'http';
  form.proxyHost = proxy.host || '';
  form.proxyPort = proxy.port || '';
  form.proxyUser = proxy.username || '';
  form.proxyPass = proxy.password || '';

  const fp = profile?.fingerprint || { mode: 'consistent' };
  existingFp.value = { ...fp };
  form.fpMode = fp.mode || 'consistent';

  if (fp.mode === 'consistent') {
    form.consistentTimezone = fp.timezone || 'Asia/Ho_Chi_Minh';
    form.consistentLanguage = fp.language || 'vi-VN';
    form.consistentWebRTC = fp.disableWebRTC !== false;
  }

  if (fp.mode === 'custom') {
    form.userAgent = fp.userAgent || '';
    form.language = fp.language || 'vi-VN';
    form.timezone = fp.timezone || 'Asia/Ho_Chi_Minh';
    form.screenW = fp.screen?.width || '';
    form.screenH = fp.screen?.height || '';
    form.ram = fp.ram || '';
    form.cpu = fp.cpuCores || '';
    form.webglVendor = fp.webglVendor || '';
    form.webglRenderer = fp.webglRenderer || '';
    form.mac = fp.mac || '';
    form.canvasNoise = !!fp.canvasNoise;
    form.disableWebRTC = !!fp.disableWebRTC;
  }
}

function fillFromFingerprint(fp) {
  existingFp.value = { ...fp };
  form.fpMode = fp.mode || 'consistent';

  if (fp.mode === 'consistent') {
    form.consistentTimezone = fp.timezone || 'Asia/Ho_Chi_Minh';
    form.consistentLanguage = fp.language || 'vi-VN';
    form.consistentWebRTC = fp.disableWebRTC !== false;
  }

  if (fp.mode === 'custom') {
    form.userAgent = fp.userAgent || '';
    form.language = fp.language || 'vi-VN';
    form.timezone = fp.timezone || 'Asia/Ho_Chi_Minh';
    form.screenW = fp.screen?.width || '';
    form.screenH = fp.screen?.height || '';
    form.ram = fp.ram || '';
    form.cpu = fp.cpuCores || '';
    form.webglVendor = fp.webglVendor || '';
    form.webglRenderer = fp.webglRenderer || '';
    form.mac = fp.mac || '';
    form.canvasNoise = !!fp.canvasNoise;
    form.disableWebRTC = !!fp.disableWebRTC;
  }
}

function onFpModeChange() {
  // mode switched via select — hints update reactively
}

function getProxyFromForm() {
  return {
    enabled: form.proxyEnabled,
    type: form.proxyType,
    host: form.proxyHost.trim(),
    port: String(form.proxyPort).trim(),
    username: form.proxyUser.trim(),
    password: form.proxyPass,
  };
}

function getFingerprintFromForm() {
  const mode = form.fpMode;
  if (mode === 'native') return { mode: 'native' };
  if (mode === 'stealth') return { mode: 'stealth' };

  if (mode === 'consistent') {
    return {
      mode: 'consistent',
      profileSeed: existingFp.value.profileSeed,
      noiseSeed: existingFp.value.noiseSeed,
      timezone: form.consistentTimezone.trim() || 'Asia/Ho_Chi_Minh',
      timezoneOffset: existingFp.value.timezoneOffset ?? -420,
      language: form.consistentLanguage.trim() || 'vi-VN',
      canvasNoise: true,
      audioNoise: true,
      disableWebRTC: form.consistentWebRTC,
    };
  }

  const w = parseInt(form.screenW, 10) || 1920;
  const h = parseInt(form.screenH, 10) || 1080;

  return {
    mode: 'custom',
    userAgent: form.userAgent.trim(),
    language: form.language.trim() || 'vi-VN',
    timezone: form.timezone.trim() || 'Asia/Ho_Chi_Minh',
    timezoneOffset: -420,
    screen: {
      width: w,
      height: h,
      availWidth: w,
      availHeight: h - 48,
      colorDepth: 24,
      pixelDepth: 24,
    },
    ram: parseInt(form.ram, 10) || 8,
    cpuCores: parseInt(form.cpu, 10) || 4,
    webglVendor: form.webglVendor.trim(),
    webglRenderer: form.webglRenderer.trim(),
    mac: form.mac.trim(),
    canvasNoise: form.canvasNoise,
    disableWebRTC: form.disableWebRTC,
  };
}

async function applyRandom() {
  const fp = await window.api.randomFingerprint();
  fillFromFingerprint(fp);
  toast(t('profile.randomApplied'));
}

async function applyNative() {
  const fp = await window.api.nativeFingerprint();
  fillFromFingerprint(fp);
  toast(t('profile.nativeApplied'));
}

async function applyConsistent() {
  const fp = await window.api.consistentFingerprint({ profileId: props.profile?.id });
  fillFromFingerprint(fp);
  toast(t('profile.consistentApplied'));
}

async function save() {
  if (!form.name.trim()) {
    toast(t('profile.nameRequired'), 'error');
    return;
  }

  if (form.proxyEnabled) {
    const host = form.proxyHost.trim();
    const port = String(form.proxyPort).trim();
    const hasPortInHost = /:\d{1,5}$/.test(host);
    if (!host || (!port && !hasPortInHost)) {
      toast(t('profile.proxyInvalid'), 'error');
      return;
    }
  }

  const data = {
    name: form.name.trim(),
    notes: form.notes.trim(),
    startupUrl: form.startupUrl.trim(),
    proxy: getProxyFromForm(),
    fingerprint: getFingerprintFromForm(),
  };

  const result = props.profile
    ? await window.api.updateProfile({ id: props.profile.id, ...data })
    : await window.api.createProfile({ ...data, randomFingerprint: false });

  if (result.success) {
    toast(props.profile ? t('profile.updated') : t('profile.created'));
    emit('saved');
  } else {
    toast(t('profile.saveFailed'), 'error');
  }
}

onMounted(() => {
  fillFromProfile(props.profile);
});
</script>

<style scoped>
.hint-warn {
  color: var(--warning, #f59e0b);
  margin-top: 8px;
}
</style>
