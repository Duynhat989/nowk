function unique(list) {
    const out = [];
    for (const item of list || []) {
        if (item && !out.includes(item)) out.push(item);
    }
    return out;
}

function wantsControl(task) {
    return /button|nút|menu|shortcut|hotkey|toggle|devtools|dev tools|click|ipc|chức năng|hành động/i
        .test(String(task || ''));
}

function wantsDevtools(task) {
    return /devtools|dev tools|openDevTools/i.test(String(task || ''));
}

function isElectronTask(task, files = []) {
    return /electron|devtools|dev tools|ipc|preload|BrowserWindow/i.test(String(task || ''))
        || (files || []).some((rel) => /preload\.(js|ts)$|(^|\/)(main|index)\.(js|ts)$/i.test(rel));
}

function hasClick(text) {
    return /@click|v-on:click|onclick\s*=|addEventListener\s*\(\s*['"]click|\.on\s*\(\s*['"]click/i
        .test(String(text || ''));
}

function hasDevtoolsImpl(text) {
    return /openDevTools\s*\(/.test(String(text || ''));
}

function hasIpcPath(text) {
    return /ipcMain\.(handle|on)|ipcRenderer\.(invoke|send)|contextBridge\.exposeInMainWorld/i
        .test(String(text || ''));
}

async function readBodies(workspace, root, paths) {
    const bodies = [];
    for (const rel of unique(paths)) {
        try {
            const { content } = await workspace.readFile(root, rel);
            bodies.push({ path: rel, content: String(content || '') });
        } catch {
            // skip
        }
    }
    return bodies;
}

async function checkBehavior(workspace, root, task, filesChanged = [], relatedFiles = []) {
    if (!wantsControl(task) || !(filesChanged || []).length) {
        return { ok: true, notes: [] };
    }

    const notes = [];
    const extra = isElectronTask(task, [...filesChanged, ...relatedFiles])
        ? ['preload.js', 'preload.ts', 'index.js', 'main.js', 'src/main.js', 'electron/main.js']
        : [];
    const bodies = await readBodies(workspace, root, [...filesChanged, ...relatedFiles, ...extra]);
    const blob = bodies.map((item) => item.content).join('\n');
    const changedBlob = (await readBodies(workspace, root, filesChanged))
        .map((item) => item.content)
        .join('\n');

    if (wantsDevtools(task) && !hasDevtoolsImpl(blob)) {
        notes.push(
            'BEHAVIOR FAIL: nút Dev Tools chưa gọi webContents.openDevTools(). '
            + 'Phải nối đủ: @click ở renderer → preload (contextBridge) → ipcMain trong main → win.webContents.openDevTools(). '
            + 'Làm theo đúng pattern ipc đã có trong project, không chỉ thêm chữ trên nút.',
        );
    }

    if (wantsControl(task) && !wantsDevtools(task) && /button|nút/i.test(task) && !hasClick(changedBlob)) {
        notes.push(
            'BEHAVIOR FAIL: đã thêm UI (nút/menu) nhưng chưa có handler. '
            + 'Nút phải @click / onclick và thực sự chạy chức năng user hỏi.',
        );
    }

    if (isElectronTask(task, relatedFiles) && wantsControl(task)) {
        const touchedBridge = (filesChanged || []).some((rel) => (
            /preload\.(js|ts)$|(^|\/)(main|index)\.(js|ts)$|ipc/i.test(rel)
        ));
        if (!touchedBridge && !hasIpcPath(changedBlob) && !hasDevtoolsImpl(changedBlob)) {
            notes.push(
                'BEHAVIOR FAIL: đây là Electron — chưa sửa preload/main/ipc. '
                + 'Tìm ipcMain.handle + contextBridge.exposeInMainWorld hiện có rồi thêm channel mới cùng cách đó.',
            );
        }
    }

    const onlySkin = (filesChanged || []).every((rel) => /\.(css|scss|less|html)$/i.test(rel));
    if (onlySkin && wantsControl(task)) {
        notes.push('BEHAVIOR FAIL: mới sửa giao diện, chưa có logic. Sửa script/main/preload nữa.');
    }

    return { ok: notes.length === 0, notes };
}

function formatBehavior(report) {
    if (!report?.notes?.length) return 'BEHAVIOR: nút/menu đã có handler.';
    return report.notes.join('\n');
}

module.exports = {
    checkBehavior,
    formatBehavior,
    wantsControl,
    wantsDevtools,
    isElectronTask,
};
