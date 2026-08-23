function compressState(state) {
    const plan = (state.plan || [])
        .map((item) => `- [${item.status}] ${item.task}`)
        .join('\n');
    const files = (state.filesChanged || []).slice(-20).join('\n') || '(none)';
    const errors = (state.currentErrors || []).slice(-4).join('\n') || '(none)';
    const tools = (state.toolLog || [])
        .slice(-12)
        .map((item) => `- ${item.type} ${item.detail || ''}`)
        .join('\n');

    return `TASK:
${state.task}

PHASE: ${state.currentPhase}
ITERATION: ${state.iteration}

PLAN:
${plan || '(none yet)'}

COMPLETED DECISIONS:
${(state.decisions || []).slice(-8).join('\n') || '(none)'}

FILES CHANGED:
${files}

CURRENT ERRORS:
${errors}

RECENT TOOLS:
${tools || '(none)'}

LAST ANALYSIS:
${String(state.lastAnalysis || '').slice(0, 800)}`;
}

module.exports = { compressState };
