# Tích hợp đăng nhập Nano (desktop)

Hướng dẫn gắn login Nano vào app Electron (theo cách NowK đang dùng).

## Tổng quan

Nano không đăng nhập trong cửa sổ app. Flow là:

1. App tạo `sessionToken` tạm.
2. Mở trình duyệt tới trang sign-in Nano kèm token đó.
3. Sau khi user đăng nhập, Nano gọi lại máy local (`localhost:27123`) hoặc deep link để gửi `access_token`.
4. App poll / nhận token → gọi API verify → lưu session → vào IDE.

```
[Login UI] → register(token) → mở veo.nanoai.pics/desktop/signin?token=…
                                      ↓
                              user đăng nhập Nano
                                      ↓
              POST/GET localhost:27123/listen  (hoặc deep link)
                                      ↓
[Login UI] poll → authFinish(accessToken) → verifyToken → auth.json
```

## Endpoint Nano

| Vai trò | URL |
|--------|-----|
| Trang đăng nhập desktop | `https://veo.nanoai.pics/desktop/signin?token=<sessionToken>` |
| Verify access token | `GET https://flow-api.nanoai.pics/api/auth/verifyToken` |
| Header verify | `Authorization: Bearer <accessToken>` |

Verify thành công trả dạng:

```json
{
  "success": true,
  "data": {
    "token": "<accessToken có thể refresh>",
    "balance": 123
  }
}
```

## Server local (callback)

App phải listen **`http://0.0.0.0:27123`** để Nano đẩy token về máy.

| Route | Method | Việc |
|-------|--------|------|
| `/listen` | GET/POST | Nhận `token` + `access_token` (body hoặc query) |
| `/api/auth/signin-register` | POST | Đăng ký session đang chờ (`{ token }`) |
| `/api/auth/signin-abandon` | POST | Hủy session đang chờ |
| `/api/auth/signin-complete` | GET/POST | Giống `/listen`; GET có thể trả HTML “Signed in” |
| `/api/auth/signin-poll` | GET | `?token=` — trả `{ success, data: { access_token } }` hoặc `{ pending: true }` |

CORS nên cho `*`. Session chờ hết hạn ~15 phút.

Payload Nano có thể gửi một trong các dạng:

- `body.data.access_token` / `body.data.accessToken`
- `body.access_token` / `body.accessToken`
- query `access_token` + `token`

## File trong NowK

| File | Vai trò |
|------|---------|
| `utils/NanoAuth.js` | Server local, poll/register/complete, verify, lưu `auth.json`, heartbeat |
| `index.js` | Khởi tạo `NanoAuth`, IPC `auth:*`, deep link |
| `preload.js` | Expose `window.api.authSession` / `authRegister` / … |
| `renderer/views/LoginView.vue` | UI “Continue with Nano” + poll |
| `renderer/App.vue` | Gate `authed`, logout, nghe `auth-heartbeat` |

Session lưu tại thư mục config app: `auth.json` → `{ accessToken, balance }`.

## Bước tích hợp (từ đầu)

### 1. Main process — class auth

- Copy / giữ `utils/NanoAuth.js`.
- Khi app ready:

```js
const NanoAuth = require('./utils/NanoAuth');
nanoAuth = new NanoAuth(configDir);
await nanoAuth.load();
await nanoAuth.startServer(); // port 27123
if (nanoAuth.cached.accessToken) nanoAuth.startWatch();
```

- Heartbeat / buộc logout:

```js
nanoAuth.onHeartbeat = (data) => sendToRenderer('auth-heartbeat', data);
nanoAuth.onForcedLogout = (data) => sendToRenderer('auth-forced-logout', data);
```

Verify định kỳ mỗi **5 phút**. Sai liên tiếp **3 lần** (không phải lỗi mạng) → clear session + forced logout.

### 2. IPC handlers

| Channel | Hành vi |
|---------|---------|
| `auth:session` | Load + verify; không hợp lệ thì clear |
| `auth:register` | `register(token)` + trả `{ url: signInUrl(token) }` |
| `auth:poll` | `poll(token)` |
| `auth:abandon` | `abandon(token)` |
| `auth:finish` | `verify(accessToken)` → save → `startWatch()` |
| `auth:logout` | `clear()` |

### 3. Preload

```js
authSession: () => ipcRenderer.invoke('auth:session'),
authRegister: (data) => ipcRenderer.invoke('auth:register', data),
authPoll: (data) => ipcRenderer.invoke('auth:poll', data),
authAbandon: (data) => ipcRenderer.invoke('auth:abandon', data),
authFinish: (data) => ipcRenderer.invoke('auth:finish', data),
authLogout: () => ipcRenderer.invoke('auth:logout'),
```

### 4. UI login

1. Mount: gọi `authSession()`. Nếu `loggedIn` → emit `login-success`.
2. Nút Nano:
   - Tạo token dạng `nano_<time>_<32bytes hex>`.
   - `authRegister({ token })` → nhận `url`.
   - `openExternal(url)`.
   - Mỗi ~1.5s `authPoll({ token })`.
3. Khi poll có `access_token` → `authFinish({ accessToken })` → vào app.
4. Nút Back: `authAbandon({ token })`, dừng poll.

### 5. Deep link (tuỳ chọn)

Protocol app nhận URL có `token` + `access_token` → `nanoAuth.applyDeepLink(url)`. Poll lần sau sẽ lấy được token dù callback HTTP chậm.

## Checklist

- [ ] Port **27123** không bị firewall / process khác chiếm
- [ ] Server listen trước khi mở trang sign-in
- [ ] Verify token trước khi coi là đã login
- [ ] Lưu `auth.json` ngoài bundle (userData / configDir)
- [ ] Heartbeat cập nhật `balance`; forced logout đưa về màn login
- [ ] Không log `accessToken` ra console production

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân gần |
|------------|-----------------|
| Poll mãi `pending` | Nano không gọi được `localhost:27123` (firewall / port bận) |
| `tokenInvalid` sau finish | Token hết hạn / verify fail |
| Login lại mỗi lần mở app | `auth.json` không ghi được hoặc verify clear session |
| Forced logout đột ngột | Verify fail 3 lần liên tiếp |

## Tham chiếu nhanh trong repo

- Logic core: `utils/NanoAuth.js`
- IPC: `index.js` (`auth:session` … `auth:logout`)
- UI: `renderer/views/LoginView.vue`
