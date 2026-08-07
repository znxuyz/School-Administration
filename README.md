# 行政工作進度追蹤系統

給學校行政老師使用的線上進度追蹤看板。老師用自己的 Google 帳號登入,建立行政計畫、
把工作拆成步驟,再逐項更新進度;全校同仁看得到彼此的進度,逾期和久未更新的工作會被明顯標示,
避免行政工作被遺忘。

- **前端**:純 HTML / CSS / JavaScript,無需建置工具,可放在 GitHub Pages(免費)
- **後端**:Firebase — Firestore 資料庫 + Google 帳號登入(免費 Spark 方案,永久有效、不會休眠)
- **費用**:0 元。以十幾二十位老師的使用量來說,離免費額度的上限還很遠

---

## 功能

| 頁面 | 內容 |
|------|------|
| **總覽** | 全校計畫進度看板。統計磚顯示計畫總數 / 進行中 / 逾期 / 待更新 / 已完成,可依學年度、處室、負責人、狀態、關鍵字篩選 |
| **我的工作** | 建立與編輯自己的計畫、拆解步驟、設定期限,並更新每個步驟的狀態 |
| **成員管理** | 僅管理者可見。維護可登入的 Email 白名單、處室、職稱與權限 |

**狀態如何判定**

| 狀態 | 條件 |
|------|------|
| 已完成 | 所有步驟都標記為「已完成」 |
| 逾期 | 尚未完成,且整體期限或任一未完成步驟的期限已經過去 |
| 待更新 | 尚未完成,且超過 14 天沒有任何更新(天數可在 `assets/config.js` 調整) |
| 進行中 | 以上皆非 |

---

## 建置步驟

### 1. Firebase 專案設定

在 [Firebase 主控台](https://console.firebase.google.com) 完成:

1. 建立專案(Google Analytics 選擇**停用**)
2. **Authentication** → 開始使用 → Sign-in method → 啟用 **Google**
3. **Firestore Database** → 建立資料庫 → Standard 版 → 位置 `asia-east1` → 正式版模式
4. **專案設定** → 你的應用程式 → 新增網頁應用程式 `</>` → 複製 `firebaseConfig`

把 `firebaseConfig` 填入 [`assets/config.js`](assets/config.js)。
這段設定屬於公開資訊,放在前端是 Firebase 的正常用法 —— 真正的存取控管由下一步的安全規則負責。

### 2. 套用安全規則

把 [`firestore.rules`](firestore.rules) 的內容整份貼到
**Firestore Database → 規則**,然後按「發布」。

沒有這一步的話,資料庫會維持在正式版模式的全鎖狀態(誰都讀不到),或是被改成測試模式的全開狀態(任何人都能讀寫)。**這一步不能跳過。**

### 3. 建立第一位管理者(重要)

系統規定只有管理者能維護名單,所以第一位管理者必須手動建立,否則沒有人進得去:

1. Firestore Database → 資料 → **開始建立集合**
2. 集合 ID 填 `allowlist`
3. 文件 ID 填**你的 Google 帳號 Email,全部小寫**(例:`principal@example.edu.tw`)
4. 新增以下欄位,型別都選 `string`:

   | 欄位 | 值 |
   |------|-----|
   | `name` | 你的姓名 |
   | `dept` | 處室,例:教務處 |
   | `title` | 職稱,例:教務主任(可留空字串) |
   | `role` | `admin` |

5. 儲存

之後其他老師就可以直接在系統的「成員管理」頁面新增,不必再回到主控台。

### 4. 部署到 GitHub Pages

1. GitHub repo → **Settings → Pages**
2. Source 選 **Deploy from a branch**,分支選本專案所在的分支,資料夾選 `/ (root)`
3. 儲存後等一兩分鐘,會得到網址,格式為 `https://<帳號>.github.io/School-Administration/`

### 5. 把網址加進 Firebase 授權網域(否則無法登入)

Firebase 預設只允許自家網域彈出登入視窗:

**Authentication → Settings(設定)→ 授權網域 → 新增網域**,填入 `<帳號>.github.io`

漏掉這一步,登入時會出現「這個網址尚未被加入 Firebase 的授權網域」。

---

## 資料結構

### `allowlist/{email}` — 可登入的成員(文件 ID 是小寫 Email)

| 欄位 | 型別 | 說明 |
|------|------|------|
| `name` | string | 姓名 |
| `dept` | string | 處室 |
| `title` | string | 職稱 |
| `role` | string | `teacher` 或 `admin` |

### `plans/{autoId}` — 行政計畫

| 欄位 | 型別 | 說明 |
|------|------|------|
| `title` | string | 計畫名稱 |
| `dept` | string | 處室 |
| `year` | number | 民國學年度,例 `114` |
| `term` | string | `1` 上學期 / `2` 下學期 / `0` 全學年 |
| `dueDate` | string | 整體期限 `YYYY-MM-DD`,可為空字串 |
| `note` | string | 備註 |
| `steps` | array | 步驟陣列,見下 |
| `ownerUid` | string | 建立者的 Firebase UID(權限判定依據) |
| `ownerEmail` | string | 建立者 Email(小寫) |
| `ownerName` | string | 建立者姓名(顯示用) |
| `createdAt` / `updatedAt` | timestamp | 建立 / 最後更新時間 |

每個 `steps` 元素:

```json
{ "title": "場地借用申請", "due": "2026-03-15", "status": "todo", "note": "" }
```

`status` 為 `todo`(未開始)/ `doing`(進行中)/ `done`(已完成)。

學年度歸檔就靠 `year` 欄位 —— 舊學年的資料全部保留,在總覽頁切換學年度即可查閱。

---

## 權限說明

| 動作 | 一般成員 | 管理者 |
|------|:--------:|:------:|
| 登入系統 | 需在名單內 | 需在名單內 |
| 查看所有人的計畫 | ✓ | ✓ |
| 建立計畫 | ✓ | ✓ |
| 編輯 / 刪除自己的計畫 | ✓ | ✓ |
| 編輯 / 刪除他人的計畫 | ✗ | ✓ |
| 維護成員名單 | ✗ | ✓ |

這些規則由 `firestore.rules` 在伺服器端強制執行,不是只靠前端隱藏按鈕 ——
即使有人繞過網頁直接呼叫 API,一樣擋得住。

---

## 常見問題

**老師說登入後顯示「尚未取得使用權限」**
該 Email 不在 `allowlist` 名單裡,或名單登記的 Email 與他登入用的 Google 帳號不同。
請到「成員管理」確認 Email 是否完全一致(系統一律以小寫比對)。

**點登入沒反應**
瀏覽器擋掉彈出視窗,請允許此網站的彈出視窗;或是第 5 步的授權網域沒設定。

**想改處室清單、調整「待更新」的天數**
編輯 `assets/config.js` 的 `DEPARTMENTS` 與 `STALE_DAYS`。

**想升級 Firebase SDK 版本**
修改 `assets/app.js` 最上方三行 import 的版本號即可。

---

## 後續可以加的功能

第一版刻意不做,需要時再加:

- 逾期或久未更新時寄 Email / LINE 提醒(需搭配 Cloud Functions 或 Apps Script)
- 一鍵複製上學年的計畫當範本
- 匯出 Excel 或列印用的進度報表
- 步驟的附件上傳(Firebase Storage)
