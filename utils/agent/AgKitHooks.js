'use strict';

const BLOCK_RULES = [
    {
        id: 'unix-root-delete',
        pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+(?:-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*)\s+(?:--\s+)?\/(?:\*|\s|$)/i,
        message: 'recursive deletion of the filesystem root',
    },
    {
        id: 'filesystem-format',
        pattern: /(?:^|[;&|]\s*)(?:sudo\s+)?mkfs(?:\.[A-Za-z0-9_-]+)?\b/i,
        message: 'filesystem formatting command',
    },
    {
        id: 'raw-disk-overwrite',
        pattern: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|vd|xvd)[A-Za-z0-9_-]*/i,
        message: 'raw disk overwrite',
    },
    {
        id: 'windows-drive-format',
        pattern: /(?:^|[;&|]\s*)format(?:\.com)?\s+[A-Za-z]:/i,
        message: 'Windows drive format',
    },
    {
        id: 'windows-root-delete',
        pattern: /remove-item\b[^\n]*-(?:recurse|r)\b[^\n]*-(?:force|fo)\b[^\n]*(?:[A-Za-z]:\\(?:\s|$)|[A-Za-z]:\\\*)/i,
        message: 'recursive deletion of a Windows drive root',
    },
    {
        id: 'curl-pipe-shell',
        pattern: /\b(curl|wget)\b[\s\S]{0,200}\|\s*(ba)?sh\b/i,
        message: 'download piped into a shell',
    },
    {
        id: 'chmod-777',
        pattern: /\bchmod\s+(-R\s+)?777\b/i,
        message: 'world-writable chmod 777',
    },
];

function evaluateCommand(command) {
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: true, reason: 'empty' };
    for (const rule of BLOCK_RULES) {
        if (rule.pattern.test(cmd)) {
            return { ok: false, rule: rule.id, reason: `BLOCKED by AG Kit (${rule.id}): ${rule.message}` };
        }
    }
    return { ok: true, reason: 'allowed' };
}

function gateAction(action) {
    const type = String(action?.type || '');
    if (!/^(run_command|run_terminal|run_start|run_test|run_build)$/.test(type)) {
        return { ok: true };
    }
    return evaluateCommand(action.command);
}

module.exports = {
    BLOCK_RULES,
    evaluateCommand,
    gateAction,
};
