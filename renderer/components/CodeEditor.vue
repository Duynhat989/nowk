<template>
  <div class="code-editor" @contextmenu.prevent="openMenu">
    <div ref="host" class="cm-host" />

    <Teleport to="body">
      <div
        v-if="menu"
        class="file-ctx-backdrop"
        @mousedown="closeMenu"
        @contextmenu.prevent="closeMenu"
      >
        <div
          class="file-ctx"
          :style="{ top: `${menu.y}px`, left: `${menu.x}px` }"
          @mousedown.stop
        >
          <button type="button" :disabled="!canPretty" @click="act('format')">
            {{ t('ide.format') }}
          </button>
          <div class="file-ctx-sep" />
          <button type="button" :disabled="!hasSelection" @click="act('cut')">{{ t('ide.cut') }}</button>
          <button type="button" :disabled="!hasSelection" @click="act('copy')">{{ t('ide.copy') }}</button>
          <button type="button" @click="act('paste')">{{ t('ide.paste') }}</button>
          <button type="button" @click="act('selectAll')">{{ t('ide.selectAll') }}</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { tags as highlightTags } from '@lezer/highlight';
import { languageSupport } from '../utils/editorLanguage.js';
import { canFormat, formatCode } from '../utils/formatCode.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  filename: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();
const host = ref(null);
const menu = ref(null);
const hasSelection = ref(false);
let view = null;
let applying = false;
const langCompartment = new Compartment();

const canPretty = computed(() => canFormat(props.filename));

const highlight = HighlightStyle.define([
  { tag: highlightTags.keyword, color: '#569cd6' },
  { tag: highlightTags.controlKeyword, color: '#c586c0' },
  { tag: highlightTags.string, color: '#ce9178' },
  { tag: highlightTags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: highlightTags.number, color: '#b5cea8' },
  { tag: highlightTags.bool, color: '#569cd6' },
  { tag: highlightTags.null, color: '#569cd6' },
  { tag: highlightTags.function(highlightTags.variableName), color: '#dcdcaa' },
  { tag: highlightTags.definition(highlightTags.variableName), color: '#9cdcfe' },
  { tag: highlightTags.propertyName, color: '#9cdcfe' },
  { tag: highlightTags.tagName, color: '#569cd6' },
  { tag: highlightTags.attributeName, color: '#9cdcfe' },
  { tag: highlightTags.angleBracket, color: '#808080' },
  { tag: highlightTags.operator, color: '#d4d4d4' },
  { tag: highlightTags.className, color: '#4ec9b0' },
  { tag: highlightTags.typeName, color: '#4ec9b0' },
  { tag: highlightTags.regexp, color: '#d16969' },
  { tag: highlightTags.meta, color: '#9cdcfe' },
  { tag: highlightTags.heading, color: '#569cd6', fontWeight: '700' },
  { tag: highlightTags.link, color: '#3794ff' },
  { tag: highlightTags.processingInstruction, color: '#808080' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#0c0c0e',
    color: '#e4e4e7',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--mono)',
    fontSize: '13px',
    lineHeight: '22px',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: '#fff',
  },
  '.cm-gutters': {
    backgroundColor: '#0c0c0e',
    color: '#52525b',
    borderRight: '1px solid #27272a',
  },
  '.cm-activeLine': { backgroundColor: '#18181b' },
  '.cm-activeLineGutter': { backgroundColor: '#18181b', color: '#a1a1aa' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#264f78',
  },
  '.cm-cursor': { borderLeftColor: '#fff' },
  '.cm-foldGutter .cm-gutterElement': { color: '#6e6e6e' },
}, { dark: true });

function currentText() {
  return view ? view.state.doc.toString() : props.modelValue;
}

function selectedText() {
  if (!view) return '';
  const range = view.state.selection.main;
  return view.state.sliceDoc(range.from, range.to);
}

function setText(next, emitChange = true) {
  if (!view) return;
  applying = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
  });
  applying = false;
  if (emitChange) emit('update:modelValue', next);
}

function syncSelection() {
  if (!view) {
    hasSelection.value = false;
    return;
  }
  const range = view.state.selection.main;
  hasSelection.value = range.from !== range.to;
}

function placeMenu(x, y) {
  syncSelection();
  menu.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - 200)),
    y: Math.max(8, Math.min(y, window.innerHeight - 200)),
  };
}

function openMenu(event) {
  placeMenu(event.clientX, event.clientY);
}

function closeMenu() {
  menu.value = null;
}

async function formatDocument() {
  if (!canPretty.value) return false;
  const source = currentText();
  const result = await formatCode(source, props.filename);
  if (!result.ok || result.code === source) return false;
  setText(result.code);
  return true;
}

async function cutSelection() {
  const text = selectedText();
  if (!text || !view) return;
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  view.dispatch(view.state.replaceSelection(''));
}

async function copySelection() {
  const text = selectedText();
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

async function pasteClipboard() {
  if (!view) return;
  try {
    const text = await navigator.clipboard.readText();
    view.dispatch(view.state.replaceSelection(text));
  } catch { /* ignore */ }
}

function selectAll() {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
}

async function act(action) {
  closeMenu();
  if (action === 'format') await formatDocument();
  if (action === 'cut') await cutSelection();
  if (action === 'copy') await copySelection();
  if (action === 'paste') await pasteClipboard();
  if (action === 'selectAll') selectAll();
  view?.focus();
}

function onKeydown(event) {
  if (event.key === 'Escape') closeMenu();
  if (event.key.toLowerCase() === 'f' && event.shiftKey && event.altKey) {
    event.preventDefault();
    formatDocument();
  }
}

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        langCompartment.of(languageSupport(props.filename)),
        syntaxHighlighting(highlight),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) syncSelection();
          if (!update.docChanged || applying) return;
          emit('update:modelValue', update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '100%' },
        }),
      ],
    }),
    parent: host.value,
  });
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  view?.destroy();
  view = null;
});

watch(() => props.filename, (name) => {
  if (!view) return;
  view.dispatch({
    effects: langCompartment.reconfigure(languageSupport(name)),
  });
});

watch(() => props.modelValue, (value) => {
  if (!view) return;
  const next = value ?? '';
  if (next === view.state.doc.toString()) return;
  setText(next, false);
});

defineExpose({
  format: formatDocument,
  focus: () => view?.focus(),
});
</script>
