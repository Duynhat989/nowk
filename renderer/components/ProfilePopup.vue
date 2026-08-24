<template>
  <div class="modal-overlay open" @click.self="$emit('close')">
    <div class="modal modal-lg profile-popup">
      <div class="modal-header">
        <div>
          <h2>{{ t('popup.title') }}</h2>
          <p class="popup-subtitle">{{ t('popup.subtitle') }}</p>
        </div>
        <button class="btn-icon" type="button" @click="$emit('close')">&times;</button>
      </div>

      <div class="popup-toolbar">
        <input
          v-model="search"
          type="search"
          class="search-input"
          :placeholder="t('popup.searchPlaceholder')"
        >
        <button class="btn btn-primary" type="button" @click="openCreate">
          {{ t('popup.saveNew') }}
        </button>
      </div>

      <div class="modal-body popup-body">
        <table class="profile-table">
          <thead>
            <tr>
              <th>{{ t('common.name') }}</th>
              <th>{{ t('popup.proxy') }}</th>
              <th>{{ t('common.status') }}</th>
              <th>{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filtered.length" class="empty-row">
              <td colspan="4">{{ t('popup.empty') }}</td>
            </tr>
            <tr
              v-for="p in filtered"
              :key="p.id"
              :class="{ 'row-current': currentId === p.id }"
            >
              <td>
                <div class="profile-name">{{ p.name }}</div>
                <div class="profile-notes">{{ modeLabel(p) }}{{ p.notes ? ` · ${p.notes}` : '' }}</div>
              </td>
              <td>{{ proxyLabel(p) }}</td>
              <td>
                <span class="badge" :class="p.status === 'running' ? 'badge-running' : 'badge-idle'">
                  {{ p.status === 'running' ? t('common.running') : t('common.ready') }}
                </span>
              </td>
              <td>
                <div class="action-btns">
                  <button
                    v-if="p.status === 'running'"
                    class="btn btn-danger btn-sm"
                    type="button"
                    @click="closeProfile(p.id)"
                  >
                    {{ t('common.stop') }}
                  </button>
                  <button
                    v-else
                    class="btn btn-success btn-sm"
                    type="button"
                    @click="openProfile(p)"
                  >
                    {{ t('common.open') }}
                  </button>
                  <button class="btn btn-secondary btn-sm" type="button" @click="openEdit(p)">
                    {{ t('common.edit') }}
                  </button>
                  <button class="btn btn-ghost btn-sm" type="button" @click="removeProfile(p)">
                    {{ t('common.delete') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <ProfileModal
    v-if="modalOpen"
    :profile="editingProfile"
    :settings="settings"
    @close="modalOpen = false"
    @saved="onSaved"
  />
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ProfileModal from './ProfileModal.vue';

const props = defineProps({
  profiles: { type: Array, default: () => [] },
  settings: { type: Object, default: () => ({}) },
  currentId: { type: String, default: '' },
});

const emit = defineEmits(['close', 'refresh', 'opened']);

const toast = inject('toast');
const { t } = useI18n();
const search = ref('');
const modalOpen = ref(false);
const editingProfile = ref(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.profiles;
  return props.profiles.filter(p => p.name.toLowerCase().includes(q));
});

function modeLabel(p) {
  return p.startupUrl && p.startupUrl !== 'about:blank' ? p.startupUrl : '';
}

function proxyLabel(p) {
  if (p.proxy?.enabled && p.proxy.host) {
    return `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}`;
  }
  return t('common.none');
}

function openCreate() {
  editingProfile.value = null;
  modalOpen.value = true;
}

function openEdit(profile) {
  editingProfile.value = profile;
  modalOpen.value = true;
}

function onSaved() {
  modalOpen.value = false;
  emit('refresh');
}

async function openProfile(profile) {
  const result = await window.api.openProfile({ id: profile.id });
  if (result.success) {
    toast(t('popup.opened'));
    emit('refresh');
    emit('opened', profile);
    emit('close');
  } else {
    toast(result.error || t('popup.openError'), 'error');
  }
}

async function closeProfile(id) {
  await window.api.closeProfile({ id });
  toast(t('popup.stopped'));
  emit('refresh');
}

async function removeProfile(profile) {
  const deleteData = confirm(t('popup.deleteConfirm', { name: profile.name }));
  const result = await window.api.deleteProfile({ id: profile.id, deleteData });
  if (result.success) {
    toast(t('popup.deleted'));
    emit('refresh');
  }
}
</script>
