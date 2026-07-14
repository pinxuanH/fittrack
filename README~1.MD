# FitTrack 網頁版(PWA)— 免 Mac、免費、隱私優先

| 功能 | 說明 |
|---|---|
| 🫀 健康儀表板 | 從 Apple 健康「匯出檔」匯入睡眠/步數/消耗/運動/心率/訓練 + 每日 20 秒手動快速輸入 |
| 🍱 飲食追蹤 | 拍照 → Gemini AI 估熱量/碳水/蛋白/脂肪 + **個人化建議(AI 會參考你今天已吃、剩餘額度、近 3 天平均)** → 自動扣每日額度(也可純手動輸入) |
| 🏋️ 重訓計時 | 每組計時、組間休息倒數、防螢幕休眠、休息結束提示音 |
| 🔒 隱私 | 無帳號無伺服器無追蹤;所有資料存手機瀏覽器本機;照片只在按「AI 分析」時傳給 Google;健康匯出檔完全本機解析 |

已通過 10 項自動化功能測試(啟動、匯入解析、額度計算、計時流程)。

---

## 🚀 上線步驟(免費,約 15 分鐘,全程免寫程式)

### 1. 註冊 GitHub(免費)
到 **github.com** 註冊帳號。

### 2. 建立網站倉庫
1. 右上角 **+** → **New repository**
2. Repository name 填:`fittrack`,選 **Public** → **Create repository**

### 3. 上傳檔案
1. 在新倉庫頁面點 **uploading an existing file**
2. 把這個資料夾裡的 **7 個檔案**(index.html、app.js、sw.js、manifest.webmanifest、3 個 png)全部拖進去 → **Commit changes**
   (README.md 可傳可不傳)

### 4. 開啟 GitHub Pages
1. 倉庫 → **Settings** → 左側 **Pages**
2. Source 選 **Deploy from a branch**,Branch 選 **main**、資料夾 `/ (root)` → **Save**
3. 等 1–2 分鐘,頁面上方會出現你的網址:
   `https://你的帳號.github.io/fittrack/`

### 5. 裝到 iPhone 主畫面
1. iPhone **Safari** 打開上面的網址
2. 點分享按鈕 □↑ → **加入主畫面**
3. 完成!主畫面上會有 FitTrack 圖示,打開全螢幕、像 App 一樣,離線也能開

### 6. 給家人朋友用
把網址傳給他們,同樣「加入主畫面」即可。**每個人的資料都存在自己手機裡,彼此看不到。** $0、不限人數、不用審核。

### 7. 申請免費 Gemini API Key(AI 熱量分析)
1. **aistudio.google.com** → Google 帳號登入 → **Get API key** → **Create API key** → 複製
   - 有訂閱 Google AI Pro 的話,用同一個 Google 帳號建 Key 可享更高用量上限(訂閱與 API 是兩個系統,Key 還是要建,但 Key 本身免費)
2. App「設定」分頁貼上儲存(每個使用者用自己的 Key;不想申請也能手動輸入熱量)

---

## 📥 匯入 Apple 健康數據

1. iPhone「健康」App → 右上角**頭像** → 最下面「**匯出所有健康資料**」→ 存到「檔案」
2. 「檔案」App 長按 zip → **解壓縮**
3. FitTrack「健康」分頁 → 匯入區選取解壓後的 **export.xml(輸出.xml)**
4. 檔案大(常見數百 MB)時解析約 1–2 分鐘,全程在你手機本機完成,不上傳

之後平日就用「每日快速輸入」(手動輸入的日子不會被之後的匯入覆蓋)。

---

## ⚠️ 網頁版與原生 App 的差異(誠實版)

- ❌ 無法「即時」自動同步 Apple 健康/Watch(Apple 不開放給瀏覽器)→ 用匯入 + 手動輸入替代
- ⚠️ 重訓計時要保持頁面開啟(已自動防螢幕休眠);iPhone 網頁沒有背景通知
- ⚠️ AI 估熱量誤差常見 ±20–30%,儲存前可修正,當快速記錄工具用
- ⚠️ 資料存在 Safari 本機儲存空間;**若 App 超過 7 天完全沒打開,iOS 可能清除網站資料** → 建議每週用「設定 → 匯出全部資料」備份一次 JSON
- ✅ 好處:免 Mac、免 $99、免審核、更新只要重新上傳檔案,所有人自動拿到新版

---

## 🔄 之後想更新功能?

改好檔案後到 GitHub 倉庫 → **Add file → Upload files** 重新上傳覆蓋即可,1–2 分鐘後所有人的 App 都是新版。

## 🔒 資安設計總結

- 純靜態網頁,無後端、無資料庫、無帳號 → 沒有可被入侵的伺服器
- GitHub Pages 強制 HTTPS
- 資料:IndexedDB / localStorage,只在使用者自己的瀏覽器
- API Key:只存使用者自己手機,絕不寫進程式碼或上傳(所以放 Public 倉庫也安全)
- 對外連線僅兩種:載入網頁本身(GitHub)、使用者主動按 AI 分析(Google Gemini)
- 零第三方套件、零 CDN 依賴 → 無供應鏈風險
