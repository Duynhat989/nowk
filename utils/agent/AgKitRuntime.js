'use strict';

const fs = require('fs');
const path = require('path');

const APP_KIT = path.join(__dirname, '..', '..', '.agents');
const CACHE = new Map();
const BODY_CAP = 4500;
const RULE_CAP = 2800;
const AGENT_CAP = 3500;
const FLOW_CAP = 2800;
const MEM_CAP = 1800;

function exists(file) {
    try {
        return fs.existsSync(file);
    } catch {
        return false;
    }
}

function readText(file, cap = 8000) {
    try {
        return String(fs.readFileSync(file, 'utf8')).slice(0, cap);
    } catch {
        return '';
    }
}

function listDir(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function parseFrontmatter(raw) {
    const text = String(raw || '');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { meta: {}, body: text };
    const meta = {};
    for (const line of match[1].split('\n')) {
        const item = line.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (!item) continue;
        let value = item[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        meta[item[1]] = value;
    }
    return { meta, body: match[2] };
}

function tokens(text) {
    return String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9+#./-]+/i)
        .map((word) => word.trim())
        .filter((word) => word.length > 2);
}

function scoreAgainst(task, haystack) {
    const hay = String(haystack || '').toLowerCase();
    let score = 0;
    for (const word of tokens(task)) {
        if (hay.includes(word)) score += Math.min(word.length, 10);
    }
    return score;
}

function resolveKitRoot(projectRoot) {
    const local = projectRoot ? path.join(projectRoot, '.agents') : '';
    if (local && exists(path.join(local, 'skills'))) return local;
    if (exists(path.join(APP_KIT, 'skills'))) return APP_KIT;
    return local || APP_KIT;
}

function loadSkillIndex(kitRoot) {
    const skillsDir = path.join(kitRoot, 'skills');
    const items = [];
    for (const entry of listDir(skillsDir)) {
        if (!entry.isDirectory()) continue;
        const file = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!exists(file)) continue;
        const raw = readText(file, 20000);
        const { meta, body } = parseFrontmatter(raw);
        const name = meta.name || entry.name;
        items.push({
            kind: 'skill',
            name,
            id: entry.name,
            path: file,
            description: meta.description || '',
            when: meta.when_to_use || meta.whenToUse || '',
            always: false,
            body,
        });
    }
    return items;
}

function loadMarkdownFolder(kitRoot, folder, kind) {
    const dir = path.join(kitRoot, folder);
    const items = [];
    for (const entry of listDir(dir)) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const file = path.join(dir, entry.name);
        const raw = readText(file, 40000);
        const { meta, body } = parseFrontmatter(raw);
        const id = path.basename(entry.name, '.md');
        items.push({
            kind,
            name: meta.name || id,
            id,
            path: file,
            description: meta.description || '',
            when: meta.when_to_use || meta.trigger || '',
            requires: `${meta.requires_skills || ''} ${meta.requires_agents || ''} ${meta.skills || ''}`,
            body,
        });
    }
    return items;
}

function inventory(kitRoot) {
    if (CACHE.has(kitRoot)) return CACHE.get(kitRoot);
    const data = {
        root: kitRoot,
        skills: loadSkillIndex(kitRoot),
        agents: loadMarkdownFolder(kitRoot, 'agent', 'agent'),
        workflows: loadMarkdownFolder(kitRoot, 'workflows', 'workflow'),
        rules: loadMarkdownFolder(kitRoot, 'rules', 'rule'),
        memory: loadMarkdownFolder(kitRoot, 'memory', 'memory'),
    };
    CACHE.set(kitRoot, data);
    return data;
}

function slashName(task) {
    const match = String(task || '').match(/(?:^|\s)\/([a-z0-9_-]+)\b/i);
    return match ? match[1].toLowerCase() : '';
}

function pickTop(items, task, extra = '', min = 8, limit = 3) {
    const query = `${task}\n${extra}`;
    return items
        .map((item) => {
            const hay = `${item.name} ${item.id} ${item.description} ${item.when} ${item.requires || ''}`;
            let score = scoreAgainst(query, hay);
            if (/debug|lỗi|error|bug|crash|fix/i.test(query) && /debug/i.test(hay)) score += 18;
            if (/vue|react|css|ui|giao diện/i.test(query) && /frontend|vue|react|ui/i.test(hay)) score += 12;
            return { ...item, score };
        })
        .filter((item) => item.score >= min)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function clip(text, cap) {
    const body = String(text || '').trim();
    if (body.length <= cap) return body;
    return `${body.slice(0, cap)}\n…[truncated — open the file if you need more]`;
}

function alwaysRules(rules, task) {
    const ui = /ui|css|giao diện|design|layout|frontend|vue|react/i.test(task);
    const picked = [];
    for (const rule of rules) {
        const id = rule.id;
        if (/core-protocol|code-rules/.test(id)) picked.push(rule);
        else if (ui && /design-rules/.test(id)) picked.push(rule);
    }
    if (!picked.length) return rules.slice(0, 2);
    return picked.slice(0, 3);
}

function route(projectRoot, task) {
    const kitRoot = resolveKitRoot(projectRoot);
    const inv = inventory(kitRoot);
    const slash = slashName(task);
    const extra = slash ? `${slash} workflow ${slash}` : '';

    const skills = pickTop(inv.skills, task, extra, 7, 2);
    if (!skills.some((item) => item.id === 'verify-changes')) {
        const verify = inv.skills.find((item) => item.id === 'verify-changes');
        if (verify) skills.push({ ...verify, score: 12 });
    }
    skills.splice(3);

    let workflows = [];
    if (slash) {
        const hit = inv.workflows.find((item) => item.id === slash || item.name === slash);
        if (hit) workflows = [{ ...hit, score: 100 }];
    }
    if (!workflows.length) workflows = pickTop(inv.workflows, task, extra, 12, 1);

    let agents = pickTop(inv.agents, task, extra, 10, 1);
    const requiredAgent = String(workflows[0]?.requires || '').match(/\b(debugger|orchestrator|frontend-specialist|backend-specialist|test-engineer|security-auditor)[a-z-]*/);
    if (requiredAgent) {
        const named = inv.agents.find((item) => item.id === requiredAgent[0] || item.name === requiredAgent[0]);
        if (named) agents = [{ ...named, score: 80 }];
    }

    const rules = alwaysRules(inv.rules, task);
    const memory = inv.memory.filter((item) => /MEMORY|project-conventions|tech-decisions/.test(item.id)).slice(0, 2);

    const registry = inv.skills.map((item) => ({
        name: item.name,
        description: String(item.description || item.when || '').slice(0, 80),
        path: path.relative(kitRoot, item.path).replace(/\\/g, '/'),
    }));

    const sections = [];
    sections.push(`AG KIT (progressive load — not the whole .agents tree)
Runtime: analyze → match rules/skills/workflows/agents → load only those files → plan → tools → hooks → verify with real command output → memory.
Skills ≠ workflows ≠ agents ≠ rules.
Task is NOT done because files were edited. done=true only after run_command/run_test/run_start evidence (or the user asked a question with no code change).
Hooks will block destructive shell commands.`);

    sections.push(`SKILL REGISTRY (names only; full text loaded only if scored relevant):\n${
        registry.map((item) => `- ${item.name}: ${item.description}`).join('\n')
    }`);

    if (rules.length) {
        sections.push(`RULES (must follow):\n${rules.map((item) => `### ${item.name}\n${clip(item.body, RULE_CAP)}`).join('\n\n')}`);
    }
    if (agents.length) {
        sections.push(`ACTIVE AGENT:\n${agents.map((item) => `### ${item.name} (score ${item.score})\n${clip(item.body, AGENT_CAP)}`).join('\n\n')}`);
    }
    if (workflows.length) {
        sections.push(`ACTIVE WORKFLOW:\n${workflows.map((item) => `### ${item.name}\n${clip(item.body, FLOW_CAP)}`).join('\n\n')}`);
    }
    if (skills.length) {
        sections.push(`LOADED SKILLS:\n${skills.map((item) => `### @${item.name} (${item.score})\n${clip(item.body, BODY_CAP)}`).join('\n\n')}`);
    }
    if (memory.length) {
        sections.push(`PROJECT MEMORY:\n${memory.map((item) => `### ${item.name}\n${clip(item.body, MEM_CAP)}`).join('\n\n')}`);
    }

    const loaded = [
        ...rules.map((item) => `rule:${item.id}`),
        ...agents.map((item) => `agent:${item.id}`),
        ...workflows.map((item) => `workflow:${item.id}`),
        ...skills.map((item) => `skill:${item.id}`),
    ];
    const announcement = loaded.length
        ? `AG Kit: ${loaded.join(', ')}`
        : 'AG Kit: registry only (no extra files matched)';

    return {
        kitRoot,
        slash,
        registry,
        skills,
        agents,
        workflows,
        rules,
        loaded,
        announcement,
        reminder: `KIT ACTIVE: ${loaded.join(', ') || 'registry'}. Editing files ≠ done. Run a real check and read the output.`,
        prompt: sections.join('\n\n').slice(0, 22000),
    };
}

function remember(projectRoot, pack, task, filesChanged) {
    const kitRoot = pack?.kitRoot || resolveKitRoot(projectRoot);
    const dir = path.join(kitRoot, 'memory');
    if (!exists(dir)) return;
    const file = path.join(dir, 'feedback-history.md');
    const line = `\n- [${new Date().toISOString().slice(0, 10)}] ${String(task).slice(0, 120)} | files: ${(filesChanged || []).slice(0, 8).join(', ') || 'none'} | kit: ${(pack?.loaded || []).join(', ')}\n`;
    try {
        fs.appendFileSync(file, line);
    } catch {
        /* ignore */
    }
}

module.exports = {
    resolveKitRoot,
    inventory,
    route,
    remember,
    parseFrontmatter,
    scoreAgainst,
};
