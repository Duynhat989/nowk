<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ profile ? t('profile.editTitle') : t('profile.createTitle') }}</h2>
        <button class="btn-icon" @click="$emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span>{{ t('profile.name') }}</span>
          <input v-model="form.name" type="text" :placeholder="t('profile.namePlaceholder')">
        </label>
        <label class="field">
          <span>{{ t('profile.startupUrl') }}</span>
          <input v-model="form.startupUrl" type="url" placeholder="https://gemini.google.com">
        </label>
        <label class="field checkbox-field">
          <input v-model="form.proxyEnabled" type="checkbox">
          <span>{{ t('profile.enableProxy') }}</span>
        </label>
        <template v-if="form.proxyEnabled">
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
        </template>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" @click="save">{{ t('profile.saveProfile') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject, onMounted, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  profile: { type: Object, default: null },
  settings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'saved']);
const toast = inject('toast');
const { t } = useI18n();

const form = reactive({
  name: '',
  startupUrl: '',
  proxyEnabled: false,
  proxyType: 'http',
  proxyHost: '',
  proxyPort: '',
  proxyUser: '',
  proxyPass: '',
});

function fillFromProfile(profile) {
  form.name = profile?.name || '';
  form.startupUrl = profile?.startupUrl || props.settings.defaultStartupUrl || '';
  const proxy = profile?.proxy || {};
  form.proxyEnabled = !!proxy.enabled;
  form.proxyType = proxy.type || 'http';
  form.proxyHost = proxy.host || '';
  form.proxyPort = proxy.port || '';
  form.proxyUser = proxy.username || '';
  form.proxyPass = proxy.password || '';
}

async function save() {
  if (!form.name.trim()) {
    toast(t('profile.nameRequired'), 'error');
    return;
  }
  if (form.proxyEnabled) {
    const host = form.proxyHost.trim();
    const port = String(form.proxyPort).trim();
    if (!host || (!port && !/:\d{1,5}$/.test(host))) {
      toast(t('profile.proxyInvalid'), 'error');
      return;
    }
  }

  const data = {
    name: form.name.trim(),
    notes: '',
    startupUrl: form.startupUrl.trim(),
    proxy: {
      enabled: form.proxyEnabled,
      type: form.proxyType,
      host: form.proxyHost.trim(),
      port: String(form.proxyPort).trim(),
      username: form.proxyUser.trim(),
      password: form.proxyPass,
    },
  };

  const result = props.profile
    ? await window.api.updateProfile({ id: props.profile.id, ...data })
    : await window.api.createProfile(data);

  if (result.success) {
    toast(props.profile ? t('profile.updated') : t('profile.created'));
    emit('saved');
  } else {
    toast(t('profile.saveFailed'), 'error');
  }
}

onMounted(() => fillFromProfile(props.profile));
</script>
