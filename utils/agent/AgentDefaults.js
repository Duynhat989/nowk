'use strict';

/** Tunables for the NowK coding agent. Edit here instead of hunting magic numbers. */

const LOOP = {
    MAX_ITERS: 16,
    MAX_ITERS_CAP: 36,
    ITERS_PER_REQ: 14,
    PLAN_OVERFLOW: 8,
};

const KIT = {
    BODY_CAP: 4500,
    RULE_CAP: 2800,
    AGENT_CAP: 3500,
    FLOW_CAP: 2800,
    MEM_CAP: 1800,
    PROMPT_CAP: 22000,
    SUMMARY_CAP: 720,
    CATALOG_ITEM_CAP: 520,
    SKILL_LIMIT: 5,
    WORKFLOW_LIMIT: 1,
    AGENT_LIMIT: 1,
    RULE_LIMIT: 4,
    MEMORY_LIMIT: 2,
    ALWAYS_SKILLS: ['verify-changes', 'clean-code'],
    ALWAYS_RULES: ['core-protocol', 'code-rules'],
    ALWAYS_MEMORY: ['MEMORY', 'project-conventions', 'tech-decisions'],
};

const INDEX = {
    MAX_FILES: 600,
    MAX_DEPTH: 8,
    MAX_FILE_CHARS: 400000,
    MAX_CHUNK_LINES: 120,
    SKIP: [
        'node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'dist-ui',
        '.user_data', '.electron-cache', '.idea', '.vscode', '.nowk', 'site-packages',
        '.mypy_cache', '.pytest_cache', 'coverage', 'build',
    ],
    DOT_DIRS: ['.agents'],
    CODE_EXT: /\.(js|mjs|cjs|ts|tsx|jsx|vue|py|css|scss|less|html|json|md)$/i,
};

const RETRIEVE = {
    K: 10,
    FILES: 12,
    TREE_SEEDS: 8,
};

const READ = {
    MAX_READ_LINES: 80,
    MAX_AROUND: 24,
    MAX_OUT: 6000,
    SMALL_FILE: 400,
};

const SESSION = {
    MAX: 16,
    TURNS: 16,
    TEXT_SLICE: 500,
};

/** Expand the user task (not file names) so vi/en requests share one meaning space. */
const TASK_GLOSS = [
    ['lỗi|bug|crash|error|fix|debug|không chạy|hỏng', 'bug error debug crash fix diagnose locate'],
    ['giao diện|ui|css|layout|restyle|giao dien|vue|vite|website|trang web|landing', 'ui css layout design frontend vue vite website typography'],
    ['api|endpoint|backend|server|route', 'api endpoint backend server rest'],
    ['test|kiểm tra|verify|chạy thử', 'test verify e2e unit'],
    ['bảo mật|security|auth|đăng nhập|login', 'security auth login vulnerability'],
    ['hiệu năng|chậm|slow|optimize|performance', 'performance optimize slow cache'],
    ['database|schema|prisma|sql|bảng', 'database schema sql migration'],
    ['deploy|ci|docker|production', 'deploy cicd docker production'],
    ['electron|ipc|preload|nút|button', 'electron ipc preload button handler'],
];

const SURVEY = {
    PRIORITY_FILES: [
        'package.json', 'index.html', 'pyproject.toml', 'requirements.txt',
        'src/App.vue', 'src/App.jsx', 'src/App.tsx', 'src/main.js', 'src/main.ts',
        'src/main.py', 'src/index.css', 'src/style.css', 'src/App.css',
        'src/router/index.js', 'src/router/index.ts',
        'vite.config.js', 'vite.config.ts', 'app.py', 'main.py',
    ],
    PRIORITY_DIRS: [
        'src/components', 'src/views', 'src/pages', 'src/layouts',
        'src/locales', 'src/i18n', 'src/router', 'src/store', 'public',
    ],
};

function expandTask(task) {
    const text = String(task || '');
    const extra = [];
    for (const [pattern, gloss] of TASK_GLOSS) {
        if (new RegExp(pattern, 'i').test(text)) extra.push(gloss);
    }
    return extra.length ? `${text}\n${extra.join(' ')}` : text;
}

module.exports = {
    LOOP,
    KIT,
    INDEX,
    RETRIEVE,
    READ,
    SESSION,
    SURVEY,
    TASK_GLOSS,
    expandTask,
};
