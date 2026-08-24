<template>
  <div class="code-editor" @contextmenu.prevent="openMenu">
    <div
      v-if="findOpen"
      class="cm-find"
      @mousedown.stop
      @contextmenu.stop
    >
      <div class="cm-find-row">
        <input
          ref="findInput"
          v-model="findText"
          type="text"
          :placeholder="t('ide.find')"
          spellcheck="false"
          @keydown="onFindKey"
        >
        <span class="cm-find-count" :class="{ empty: !matchTotal }">{{ matchLabel }}</span>
        <button type="button" class="cm-find-toggle" :class="{ on: matchCase }" :title="t('ide.matchCase')" @click="toggleOpt('case')">Aa</button>
        <button type="button" class="cm-find-toggle" :class="{ on: wholeWord }" :title="t('ide.wholeWord')" @click="toggleOpt('word')">ab</button>
        <button type="button" class="cm-find-toggle" :class="{ on: useRegex }" :title="t('ide.useRegex')" @click="toggleOpt('regex')">.*</button>
        <button type="button" :title="t('ide.findPrev')" @click="goPrev">↑</button>
        <button type="button" :title="t('ide.findNext')" @click="goNext">↓</button>
        <button
          type="button"
          class="cm-find-toggle"
          :class="{ on: replaceOpen }"
          :title="t('ide.replace')"
          @click="replaceOpen = !replaceOpen"
        >⇄</button>
        <button type="button" :title="t('common.close')" @click="closeFind">×</button>
      </div>
      <div v-if="replaceOpen" class="cm-find-row">
        <input
          v-model="replaceText"
          type="text"
          :placeholder="t('ide.replace')"
          spellcheck="false"
          @keydown="onReplaceKey"
        >
        <button type="button" @click="doReplace">{{ t('ide.replace') }}</button>
        <button type="button" @click="doReplaceAll">{{ t('ide.replaceAll') }}</button>
      </div>
    </div>

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
          <button type="button" @click="act('find')">{{ t('ide.find') }}</button>
          <button type="button" @click="act('replace')">{{ t('ide.replace') }}</button>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
import {
  SearchQuery,
  findNext,
  findPrevious,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  selectNextOccurrence,
  setSearchQuery,
} from '@codemirror/search';
import { languageSupport } from '../utils/editorLanguage.js';
import { canFormat, formatCode } from '../utils/formatCode.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  filename: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();
const host = ref(null);
const findInput = ref(null);
const menu = ref(null);
const hasSelection = ref(false);
const findOpen = ref(false);
const replaceOpen = ref(false);
const findText = ref('');
const replaceText = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const useRegex = ref(false);
const matchIndex = ref(0);
const matchTotal = ref(0);
const queryValid = ref(true);
let view = null;
let applying = false;
const langCompartment = new Compartment();
const isMac = window.platform === 'darwin';

const canPretty = computed(() => canFormat(props.filename));
const matchLabel = computed(() => {
  if (!findText.value) return '';
  if (!queryValid.value) return t('ide.invalidRegex');
  if (!matchTotal.value) return t('ide.noResults');
  return t('ide.matchCount', { current: matchIndex.value || 1, total: matchTotal.value });
});

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
  '.cm-searchMatch': { backgroundColor: '#623315', outline: '1px solid #ffa657' },
  '.cm-searchMatch-selected': { backgroundColor: '#515c6a', outline: '1px solid #f8f8f2' },
  '.cm-selectionMatch': { backgroundColor: '#3a3d41' },
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

function makeQuery() {
  return new SearchQuery({
    search: findText.value,
    replace: replaceText.value,
    caseSensitive: matchCase.value,
    regexp: useRegex.value,
    wholeWord: wholeWord.value,
  });
}

function applyQuery() {
  if (!view) return makeQuery();
  const query = makeQuery();
  queryValid.value = !findText.value || query.valid;
  view.dispatch({ effects: setSearchQuery.of(query) });
  refreshCount(query);
  return query;
}

function refreshCount(query = makeQuery()) {
  if (!view || !query.search || !query.valid) {
    matchIndex.value = 0;
    matchTotal.value = 0;
    return;
  }
  const sel = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cursor = query.getCursor(view.state);
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    const match = step.value;
    total += 1;
    if (match.from === sel.from && match.to === sel.to) current = total;
    if (total >= 9999) break;
  }
  matchTotal.value = total;
  matchIndex.value = current;
}

function openFind(withReplace = false) {
  const selected = selectedText();
  if (selected && !selected.includes('\n')) findText.value = selected;
  findOpen.value = true;
  replaceOpen.value = withReplace;
  applyQuery();
  nextTick(() => {
    findInput.value?.focus();
    findInput.value?.select();
  });
}

function closeFind() {
  findOpen.value = false;
  replaceOpen.value = false;
  if (view) {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
    view.focus();
  }
  matchIndex.value = 0;
  matchTotal.value = 0;
}

function goNext() {
  if (!view) return;
  applyQuery();
  findNext(view);
  refreshCount();
}

function goPrev() {
  if (!view) return;
  applyQuery();
  findPrevious(view);
  refreshCount();
}

function doReplace() {
  if (!view) return;
  applyQuery();
  replaceNext(view);
  refreshCount();
}

function doReplaceAll() {
  if (!view) return;
  applyQuery();
  replaceAll(view);
  refreshCount();
}

function toggleOpt(kind) {
  if (kind === 'case') matchCase.value = !matchCase.value;
  if (kind === 'word') wholeWord.value = !wholeWord.value;
  if (kind === 'regex') useRegex.value = !useRegex.value;
  applyQuery();
}

function onFindKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) goPrev();
    else goNext();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFind();
  }
}

function onReplaceKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    doReplace();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFind();
  }
}

function placeMenu(x, y) {
  syncSelection();
  menu.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - 200)),
    y: Math.max(8, Math.min(y, window.innerHeight - 240)),
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
  if (action === 'find') openFind(false);
  if (action === 'replace') openFind(true);
  if (action === 'cut') await cutSelection();
  if (action === 'copy') await copySelection();
  if (action === 'paste') await pasteClipboard();
  if (action === 'selectAll') selectAll();
  if (action !== 'find' && action !== 'replace') view?.focus();
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    closeMenu();
    if (findOpen.value) {
      event.preventDefault();
      closeFind();
    }
  }
  if (event.key.toLowerCase() === 'f' && event.shiftKey && event.altKey && !(event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    formatDocument();
  }
}

watch(findText, () => { if (findOpen.value) applyQuery(); });
watch(replaceText, () => { if (findOpen.value) applyQuery(); });

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
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-f', preventDefault: true, run: () => { openFind(false); return true; } },
          { key: 'Mod-Alt-f', preventDefault: true, run: () => { openFind(true); return true; } },
          { key: 'Mod-h', preventDefault: true, run: () => {
            if (isMac) return false;
            openFind(true);
            return true;
          } },
          { key: 'F3', run: () => { goNext(); return true; } },
          { key: 'Shift-F3', run: () => { goPrev(); return true; } },
          { key: 'Mod-g', preventDefault: true, run: () => { goNext(); return true; } },
          { key: 'Shift-Mod-g', preventDefault: true, run: () => { goPrev(); return true; } },
          { key: 'Mod-d', preventDefault: true, run: selectNextOccurrence },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        langCompartment.of(languageSupport(props.filename)),
        syntaxHighlighting(highlight),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            syncSelection();
            if (findOpen.value) refreshCount();
          }
          if (!update.docChanged || applying) return;
          emit('update:modelValue', update.state.doc.toString());
          if (findOpen.value) refreshCount();
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
  openFind,
  findNext: goNext,
  findPrev: goPrev,
});
</script>
