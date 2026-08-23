<template>
  <div class="toast-container">
    <div
      v-for="item in toasts"
      :key="item.id"
      class="toast"
      :class="item.type"
    >
      {{ item.message }}
    </div>
  </div>
</template>

<script setup>
defineProps({
  toasts: { type: Array, default: () => [] },
});
</script>
