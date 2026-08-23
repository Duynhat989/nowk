<template>
  <header v-if="isMac" class="titlebar mac">
    <span class="titlebar-title">NowK</span>
  </header>
</template>

<script setup>
const isMac = window.platform === 'darwin';
</script>
