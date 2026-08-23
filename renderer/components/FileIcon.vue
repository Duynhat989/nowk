<template>
  <svg class="file-svg" :class="kind" viewBox="0 0 16 16" aria-hidden="true">
    <template v-if="kind === 'folder'">
      <path fill="#dcb67a" d="M1.5 4.2A1.2 1.2 0 012.7 3h3.1l1.1 1.2h6.4A1.2 1.2 0 0114.5 5.4v7A1.2 1.2 0 0113.3 13.6H2.7A1.2 1.2 0 011.5 12.4z"/>
      <path v-if="open" fill="#c09553" d="M1.5 6.5h13v5.9a1.2 1.2 0 01-1.2 1.2H2.7A1.2 1.2 0 011.5 12.4z"/>
    </template>
    <template v-else-if="kind === 'js'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#f1e05a"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#3b3200" font-size="6.4" font-weight="700" font-family="Inter, sans-serif">JS</text>
    </template>
    <template v-else-if="kind === 'ts'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#3178c6"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="6.2" font-weight="700" font-family="Inter, sans-serif">TS</text>
    </template>
    <template v-else-if="kind === 'json'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#cbcb41"/>
      <text x="8" y="11.4" text-anchor="middle" fill="#3b3b00" font-size="6.5" font-weight="700" font-family="Inter, sans-serif">{ }</text>
    </template>
    <template v-else-if="kind === 'vue'">
      <path fill="#42b883" d="M8 2.2L13.8 13H10.9L8 7.4 5.1 13H2.2z"/>
    </template>
    <template v-else-if="kind === 'css'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#563d7c"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="5.4" font-weight="700" font-family="Inter, sans-serif">CSS</text>
    </template>
    <template v-else-if="kind === 'html'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#e34c26"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="5" font-weight="700" font-family="Inter, sans-serif">HTML</text>
    </template>
    <template v-else-if="kind === 'md'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#519aba"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#fff" font-size="6" font-weight="700" font-family="Inter, sans-serif">MD</text>
    </template>
    <template v-else-if="kind === 'py'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#3572a5"/>
      <text x="8" y="11.2" text-anchor="middle" fill="#ffd43b" font-size="6.2" font-weight="700" font-family="Inter, sans-serif">PY</text>
    </template>
    <template v-else-if="kind === 'image'">
      <rect width="14" height="14" x="1" y="1" rx="2" fill="#3d5a80"/>
      <path fill="#98c1d9" d="M3 11.5l2.6-3.2 1.8 2.1 2.4-3.1L13 11.5z"/>
      <circle cx="5.2" cy="5.2" r="1.2" fill="#e0fbfc"/>
    </template>
    <template v-else-if="kind === 'git'">
      <circle cx="8" cy="8" r="6.2" fill="#f05032"/>
      <path fill="#fff" d="M8.8 4.2v3.1l2.2 2.2-.9.9-2.5-2.5V4.2z"/>
    </template>
    <template v-else-if="kind === 'vite'">
      <path fill="#bd34fe" d="M8 1.6l6.4 12.2H1.6z"/>
      <path fill="#41d1ff" d="M8 5.2l3.2 8.6H4.8z"/>
    </template>
    <template v-else-if="kind === 'txt'">
      <path fill="#8b8b8b" d="M3 2h7l3 3v9H3z"/>
      <path fill="#5a5a5a" d="M10 2v3h3"/>
      <path stroke="#d0d0d0" stroke-width="1" d="M5 8h6M5 10.2h6M5 12.4h4"/>
    </template>
    <template v-else>
      <path fill="#6e7681" d="M3 2h7l3 3v9H3z"/>
      <path fill="#4b5563" d="M10 2v3h3"/>
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, default: '' },
  type: { type: String, default: 'file' },
  open: { type: Boolean, default: false },
});

const kind = computed(() => {
  if (props.type === 'dir') return 'folder';
  const name = props.name.toLowerCase();
  if (name === 'vite.config.js' || name === 'vite.config.ts' || name === 'vite.config.mjs') return 'vite';
  if (name === '.gitignore' || name === '.gitattributes') return 'git';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return 'js';
  if (['ts', 'tsx'].includes(ext)) return 'ts';
  if (ext === 'json') return 'json';
  if (ext === 'vue') return 'vue';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['py', 'pyc'].includes(ext)) return 'py';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image';
  if (['txt', 'log', 'env'].includes(ext) || name === 'requirements.txt') return 'txt';
  return 'file';
});
</script>
