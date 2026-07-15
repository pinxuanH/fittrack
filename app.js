/* FitTrack PWA — 所有資料只存在本機(IndexedDB / localStorage) */
"use strict";

/* ============ 小工具 ============ */
const $ = (id) => document.getElementById(id);
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), 2200);
}
const fmtMin = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

/* ============ 設定(localStorage) ============ */
const DEFAULTS = { budget: 2000, carb: 250, protein: 120, fat: 65, rest: 90 };
function getSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("ft_settings") || "{}")); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings(s) { localStorage.setItem("ft_settings", JSON.stringify(s)); }
const getApiKey = () => localStorage.getItem("ft_apikey") || "";

/* ============ IndexedDB ============ */
let db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fittrack", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("meals")) {
        const s = d.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
      }
      if (!d.objectStoreNames.contains("health")) d.createObjectStore("health", { keyPath: "date" });
      if (!d.objectStoreNames.contains("workouts")) d.createObjectStore("workouts", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("hkworkouts")) d.createObjectStore("hkworkouts", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function idb(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const out = fn(os);
    tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}
const idbPut = (store, val) => idb(store, "readwrite", (os) => os.put(val));
const idbDel = (store, key) => idb(store, "readwrite", (os) => os.delete(key));
const idbGet = (store, key) => idb(store, "readonly", (os) => os.get(key));
const idbAll = (store) => idb(store, "readonly", (os) => os.getAll());
const idbClear = (store) => idb(store, "readwrite", (os) => os.clear());

/* ============ 分頁切換 ============ */
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    $(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-health") renderHealth();
    if (btn.dataset.tab === "tab-food") renderFood();
  });
});

/* ==================================================
   健康分頁
================================================== */
async function renderHealth() {
  const today = await idbGet("health", todayStr());
  const cards = [
    ["🛏", "昨晚睡眠", today && today.sleepHours != null ? today.sleepHours.toFixed(1) : "--", "小時"],
    ["👟", "步數", today && today.steps != null ? Math.round(today.steps).toLocaleString() : "--", "步"],
    ["🔥", "活動消耗", today && today.activeEnergy != null ? Math.round(today.activeEnergy) : "--", "kcal"],
    ["🏃", "運動時間", today && today.exerciseMinutes != null ? Math.round(today.exerciseMinutes) : "--", "分鐘"],
    ["❤️", "安靜心率", today && today.restingHR ? Math.round(today.restingHR) : "--", "bpm"],
  ];
  $("healthCards").innerHTML = cards.map(([ic, t, v, u]) =>
    `<div class="card metric" style="margin:0"><div class="t">${ic} ${t}</div><div class="v">${v}<small>${u}</small></div></div>`
  ).join("");

  // 最近 7 天
  const all = await idbAll("health");
  all.sort((a, b) => b.date.localeCompare(a.date));
  const last7 = all.slice(0, 7);
  $("weekList").innerHTML = last7.length === 0 ? '<p class="sub small">尚無資料</p>' :
    last7.map((r) =>
      `<div class="listitem"><div class="grow"><div class="name">${r.date}${r.source === "manual" ? '<span class="pill">手動</span>' : '<span class="pill">匯入</span>'}</div>
       <div class="detail">睡 ${r.sleepHours != null ? r.sleepHours.toFixed(1) : "-"}h・${r.steps != null ? Math.round(r.steps).toLocaleString() : "-"} 步・${r.activeEnergy != null ? Math.round(r.activeEnergy) : "-"} kcal・動 ${r.exerciseMinutes != null ? Math.round(r.exerciseMinutes) : "-"} 分</div></div></div>`
    ).join("");

  // 匯入的訓練
  const hk = await idbAll("hkworkouts");
  hk.sort((a, b) => b.date.localeCompare(a.date));
  $("workoutImports").innerHTML = hk.length === 0 ? '<p class="sub small">匯入健康資料後顯示</p>' :
    hk.slice(0, 10).map((w) =>
      `<div class="listitem"><div class="grow"><div class="name">🏋️ ${w.type}</div>
       <div class="detail">${w.date}</div></div><div class="kcal">${Math.round(w.minutes)} 分鐘</div></div>`
    ).join("");
}

$("hDate").value = todayStr();
$("hSaveBtn").addEventListener("click", async () => {
  const date = $("hDate").value || todayStr();
  const rec = (await idbGet("health", date)) || { date };
  const read = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
  const sleep = read("hSleep"), steps = read("hSteps"), energy = read("hEnergy"), ex = read("hExercise");
  if (sleep != null) rec.sleepHours = sleep;
  if (steps != null) rec.steps = steps;
  if (energy != null) rec.activeEnergy = energy;
  if (ex != null) rec.exerciseMinutes = ex;
  rec.source = "manual";
  await idbPut("health", rec);
  ["hSleep", "hSteps", "hEnergy", "hExercise"].forEach((id) => { $(id).value = ""; });
  toast("已儲存 " + date);
  renderHealth();
});

/* ---------- Apple 健康 export.xml 串流解析 ---------- */
const HK_TYPES = {
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
  steps: "HKQuantityTypeIdentifierStepCount",
  energy: "HKQuantityTypeIdentifierActiveEnergyBurned",
  exercise: "HKQuantityTypeIdentifierAppleExerciseTime",
  rhr: "HKQuantityTypeIdentifierRestingHeartRate",
};
const SLEEP_ASLEEP = ["AsleepUnspecified", "AsleepCore", "AsleepDeep", "AsleepREM", "HKCategoryValueSleepAnalysisAsleep"];
const WORKOUT_NAMES = {
  HKWorkoutActivityTypeRunning: "跑步", HKWorkoutActivityTypeWalking: "健走",
  HKWorkoutActivityTypeCycling: "騎車", HKWorkoutActivityTypeTraditionalStrengthTraining: "重量訓練",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "功能性訓練", HKWorkoutActivityTypeSwimming: "游泳",
  HKWorkoutActivityTypeYoga: "瑜伽", HKWorkoutActivityTypeHiking: "登山",
  HKWorkoutActivityTypeHighIntensityIntervalTraining: "HIIT", HKWorkoutActivityTypeCoreTraining: "核心訓練",
  HKWorkoutActivityTypeElliptical: "滑步機", HKWorkoutActivityTypeRowing: "划船",
};
const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : "";
};
function parseAppleDate(s) {
  // "2026-07-14 07:30:00 +0800" → ISO
  const iso = s.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}
function ensureDay(daily, date) {
  if (!daily[date]) daily[date] = { sleep: {}, steps: {}, energy: {}, exercise: {}, rhr: null };
  return daily[date];
}
function processChunk(text, daily, workouts) {
  // Record(自閉合標籤,一行一筆)
  const recRe = /<Record [^>]*\/>/g;
  let m;
  while ((m = recRe.exec(text)) !== null) {
    const tag = m[0];
    const type = attr(tag, "type");
    if (type === HK_TYPES.sleep) {
      const val = attr(tag, "value");
      if (!SLEEP_ASLEEP.some((k) => val.indexOf(k) !== -1)) continue;
      const st = parseAppleDate(attr(tag, "startDate"));
      const en = parseAppleDate(attr(tag, "endDate"));
      if (!st || !en) continue;
      const date = attr(tag, "endDate").slice(0, 10);
      const src = attr(tag, "sourceName") || "?";
      const day = ensureDay(daily, date);
      day.sleep[src] = (day.sleep[src] || 0) + (en - st) / 3600000;
    } else if (type === HK_TYPES.steps || type === HK_TYPES.energy || type === HK_TYPES.exercise) {
      const v = parseFloat(attr(tag, "value"));
      if (!isFinite(v)) continue;
      const date = attr(tag, "startDate").slice(0, 10);
      const src = attr(tag, "sourceName") || "?";
      const day = ensureDay(daily, date);
      const key = type === HK_TYPES.steps ? "steps" : type === HK_TYPES.energy ? "energy" : "exercise";
      day[key][src] = (day[key][src] || 0) + v;
    } else if (type === HK_TYPES.rhr) {
      const v = parseFloat(attr(tag, "value"));
      if (!isFinite(v)) continue;
      const date = attr(tag, "startDate").slice(0, 10);
      ensureDay(daily, date).rhr = v;
    }
  }
  // Workout(取開頭標籤)
  const wRe = /<Workout [^>]*>/g;
  while ((m = wRe.exec(text)) !== null) {
    const tag = m[0];
    const t = attr(tag, "workoutActivityType");
    if (!t) continue;
    const dur = parseFloat(attr(tag, "duration"));
    workouts.push({
      date: attr(tag, "startDate").slice(0, 10),
      type: WORKOUT_NAMES[t] || "運動",
      minutes: isFinite(dur) ? dur : 0,
    });
  }
}
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const prog = $("importProgress"), status = $("importStatus");
  prog.style.display = "block";
  status.textContent = "解析中…(檔案大時需 1–2 分鐘,請勿離開)";
  const daily = {}, workouts = [];
  try {
    const CHUNK = 8 * 1024 * 1024;
    let offset = 0, tail = "";
    while (offset < file.size) {
      const text = await file.slice(offset, offset + CHUNK).text();
      let data = tail + text;
      const cut = data.lastIndexOf("\n");
      if (cut >= 0) { tail = data.slice(cut + 1); data = data.slice(0, cut + 1); }
      else { tail = data; data = ""; }
      processChunk(data, daily, workouts);
      offset += CHUNK;
      prog.value = Math.min(offset / file.size, 1);
      await new Promise((r) => setTimeout(r, 0)); // 讓 UI 呼吸
    }
    processChunk(tail, daily, workouts);

    // 寫入(同來源取最大值避免 iPhone+Watch 重複計算;手動紀錄不覆蓋)
    let count = 0;
    const maxOf = (obj) => { const vs = Object.values(obj); return vs.length ? Math.max.apply(null, vs) : null; };
    for (const date of Object.keys(daily)) {
      const d = daily[date];
      const existing = await idbGet("health", date);
      if (existing && existing.source === "manual") continue;
      const rec = { date, source: "import" };
      const sleep = maxOf(d.sleep), steps = maxOf(d.steps), energy = maxOf(d.energy), ex = maxOf(d.exercise);
      if (sleep != null) rec.sleepHours = sleep;
      if (steps != null) rec.steps = steps;
      if (energy != null) rec.activeEnergy = energy;
      if (ex != null) rec.exerciseMinutes = ex;
      if (d.rhr != null) rec.restingHR = d.rhr;
      await idbPut("health", rec);
      count++;
    }
    await idbClear("hkworkouts");
    workouts.sort((a, b) => b.date.localeCompare(a.date));
    for (const w of workouts.slice(0, 50)) await idbPut("hkworkouts", w);

    status.textContent = "✅ 完成!匯入 " + count + " 天的數據、" + workouts.length + " 次訓練。";
    toast("匯入完成");
    renderHealth();
  } catch (err) {
    status.textContent = "❌ 解析失敗:" + err.message;
  } finally {
    prog.style.display = "none";
    e.target.value = "";
  }
});

/* ==================================================
   飲食分頁
================================================== */
const MEAL_TYPES = ["早餐", "午餐", "晚餐", "點心"];
let mealImage = null; // {dataUrl, base64}
let currentMealType = defaultMealType();
function defaultMealType() {
  const h = new Date().getHours();
  if (h >= 4 && h < 11) return "早餐";
  if (h >= 11 && h < 15) return "午餐";
  if (h >= 15 && h < 17) return "點心";
  if (h >= 17 && h < 22) return "晚餐";
  return "點心";
}
async function todayMeals() {
  const all = await idbAll("meals");
  return all.filter((m) => m.date === todayStr());
}
async function renderFood() {
  const s = getSettings();
  const meals = await todayMeals();
  const sum = (k) => meals.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const cal = sum("calories"), remaining = s.budget - cal;

  const C = 490;
  const ratio = Math.min(cal / Math.max(s.budget, 1), 1);
  const ring = $("budgetRing");
  ring.setAttribute("stroke-dashoffset", String(C * (1 - ratio)));
  ring.setAttribute("stroke", remaining >= 0 ? "var(--green)" : "var(--red)");
  $("ringTitle").textContent = remaining >= 0 ? "還可以吃" : "已超過";
  $("ringValue").textContent = String(Math.abs(Math.round(remaining)));
  $("ringValue").style.color = remaining >= 0 ? "" : "var(--red)";
  $("budgetSummary").textContent = "今日額度 " + s.budget + " kcal・已吃 " + Math.round(cal) + " kcal";

  const macros = [
    ["碳水", sum("carbs"), s.carb, "var(--orange)"],
    ["蛋白質", sum("protein"), s.protein, "var(--blue)"],
    ["脂肪", sum("fat"), s.fat, "#eab308"],
  ];
  $("macroRow").innerHTML = macros.map(([t, v, target, color]) =>
    `<div class="macro"><div class="sub small">${t}</div><b>${Math.round(v)}g</b>
     <div class="bar"><i style="width:${Math.min(v / Math.max(target, 1) * 100, 100)}%; background:${color}"></i></div>
     <div class="sub" style="font-size:11px">目標 ${target}g</div></div>`
  ).join("");

  meals.sort((a, b) => b.ts - a.ts);
  $("mealList").innerHTML = meals.length === 0 ? '<p class="sub small">還沒有紀錄,按上面「記錄一餐」吧!</p>' :
    meals.map((m) =>
      `<div class="listitem">
        ${m.thumb ? `<img src="${m.thumb}" alt="">` : '<span style="font-size:34px">🍽</span>'}
        <div class="grow">
          <div class="name">${m.mealType}・${escapeHtml(m.name)}</div>
          <div class="detail">碳 ${Math.round(m.carbs)}g・蛋 ${Math.round(m.protein)}g・脂 ${Math.round(m.fat)}g</div>
          ${m.advice ? `<div class="advice">${escapeHtml(m.advice)}</div>` : ""}
        </div>
        <div><div class="kcal">${Math.round(m.calories)} kcal</div>
        <button class="secondary" style="padding:4px 10px; font-size:12px; margin-top:4px" onclick="deleteMeal(${m.id})">刪除</button></div>
      </div>`
    ).join("");
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
window.deleteMeal = async (id) => {
  await idbDel("meals", id);
  renderFood();
};

/* ---------- 新增一餐 ---------- */
function renderMealTypeSeg() {
  $("mealTypeSeg").innerHTML = MEAL_TYPES.map((t) =>
    `<button type="button" class="${t === currentMealType ? "on" : ""}" data-t="${t}">${t}</button>`).join("");
  $("mealTypeSeg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { currentMealType = b.dataset.t; renderMealTypeSeg(); }));
}
$("addMealBtn").addEventListener("click", () => {
  mealImage = null;
  currentMealType = defaultMealType();
  renderMealTypeSeg();
  $("mealPreview").style.display = "none";
  $("analyzeBtn").style.display = "none";
  $("mealResult").style.display = "none";
  $("mealError").textContent = "";
  $("mealSaveBtn").disabled = true;
  ["rName", "rCal", "rCarb", "rProtein", "rFat"].forEach((id) => { $(id).value = ""; });
  $("rAdvice").textContent = "";
  $("mealDialog").showModal();
});
$("mealCancelBtn").addEventListener("click", () => $("mealDialog").close());
$("takePhotoBtn").addEventListener("click", () => $("mealPhoto").click());
$("pickPhotoBtn").addEventListener("click", () => $("mealAlbum").click());
[$("mealPhoto"), $("mealAlbum")].forEach((inp) =>
  inp.addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    mealImage = await resizeImage(f, 1024);
    $("mealPreview").src = mealImage.dataUrl;
    $("mealPreview").style.display = "block";
    $("analyzeBtn").style.display = "block";
    e.target.value = "";
  }));
function resizeImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(maxDim / Math.max(img.width, img.height), 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      URL.revokeObjectURL(url);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("照片讀取失敗")); };
    img.src = url;
  });
}
$("manualBtn").addEventListener("click", () => {
  $("mealResult").style.display = "block";
  $("mealSaveBtn").disabled = false;
});
$("analyzeBtn").addEventListener("click", async () => {
  if (!mealImage) return;
  const key = getApiKey();
  if (!key) { $("mealError").textContent = "請先到「設定」貼上 Gemini API Key(免費申請),或改用手動輸入。"; return; }
  const btn = $("analyzeBtn");
  btn.disabled = true; btn.textContent = "⏳ AI 分析中…";
  $("mealError").textContent = "";
  try {
    const ctx = await buildDietContext();
    const r = await analyzeMeal(mealImage.base64, key, ctx);
    $("rName").value = r.name;
    $("rCal").value = Math.round(r.calories);
    $("rCarb").value = Math.round(r.carbs);
    $("rProtein").value = Math.round(r.protein);
    $("rFat").value = Math.round(r.fat);
    $("rAdvice").textContent = r.advice || "";
    $("mealResult").style.display = "block";
    $("mealSaveBtn").disabled = false;
  } catch (err) {
    $("mealError").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "✨ AI 分析熱量";
  }
});

/* 本地「記憶」:把近況整理成摘要一起給 AI,記憶本體只存在此裝置 */
async function buildDietContext() {
  try {
    const s = getSettings();
    const all = await idbAll("meals");
    const today = todayStr();
    const tMeals = all.filter((m) => m.date === today);
    const sum = (arr, k) => arr.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const cal = sum(tMeals, "calories");
    let ctx = "今日已吃 " + Math.round(cal) + " kcal(額度 " + s.budget + ",剩 " + Math.round(s.budget - cal) + ")"
      + ";碳水 " + Math.round(sum(tMeals, "carbs")) + "/" + s.carb + "g"
      + ";蛋白質 " + Math.round(sum(tMeals, "protein")) + "/" + s.protein + "g"
      + ";脂肪 " + Math.round(sum(tMeals, "fat")) + "/" + s.fat + "g。";
    if (tMeals.length) ctx += "今天已吃:" + tMeals.map((m) => m.mealType + " " + m.name + "(" + Math.round(m.calories) + "kcal)").join("、") + "。";
    const days = {};
    all.forEach((m) => { if (m.date !== today) { days[m.date] = (days[m.date] || 0) + (Number(m.calories) || 0); } });
    const recent = Object.keys(days).sort().slice(-3);
    if (recent.length) {
      const avg = recent.reduce((a, d) => a + days[d], 0) / recent.length;
      ctx += "近 " + recent.length + " 天平均每日 " + Math.round(avg) + " kcal。";
    }
    const h = await idbGet("health", today);
    if (h && h.activeEnergy != null) ctx += "今日活動消耗 " + Math.round(h.activeEnergy) + " kcal。";
    return ctx;
  } catch (e) { return ""; }
}

const MODEL_CANDIDATES = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
function geminiCall(model, key, body) {
  return fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
}
/* 候選模型全滅時,直接問 Google 目前可用的模型 */
async function listFlashModel(key) {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const usable = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"));
    const best = usable.find((m) => /flash/i.test(m.name) && !/lite|preview|image|tts|live|thinking|8b/i.test(m.name))
      || usable.find((m) => /flash/i.test(m.name)) || usable[0];
    return best ? best.name.replace(/^models\//, "") : null;
  } catch (e) { return null; }
}

async function analyzeMeal(base64, key, ctx) {
  const prompt = '你是專業營養師。請分析這張餐點照片,估算整份餐點的營養成分。請「只」回傳以下格式的 JSON,不要加任何其他文字:{"name":"餐點名稱(繁體中文)","calories":數字,"carbs":數字,"protein":數字,"fat":數字,"advice":"一到兩句繁體中文的飲食建議"}。calories 單位 kcal,carbs/protein/fat 單位公克。如果照片不是食物,name 填「非食物」,數值全填 0。'
    + (ctx ? '\n以下是這位使用者的近期狀況,advice 請針對此餐與這些數據給出具體個人化建議(例如還缺多少蛋白質、額度剩多少該怎麼配):\n' + ctx : '');
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }],
    generationConfig: { temperature: 0.2, response_mime_type: "application/json" },
  };
  const cached = localStorage.getItem("ft_model");
  let candidates = MODEL_CANDIDATES.slice();
  if (cached) candidates = [cached].concat(candidates.filter((m) => m !== cached));
  let resp = null;
  for (const model of candidates) {
    try {
      resp = await geminiCall(model, key, body);
    } catch (e) {
      throw new Error("連線失敗,請確認網路。");
    }
    if (resp.status === 404) { resp = null; continue; } // 模型被 Google 下架 → 換下一個
    if (resp.ok) localStorage.setItem("ft_model", model);
    break;
  }
  if (resp === null) {
    const found = await listFlashModel(key);
    if (found) {
      resp = await geminiCall(found, key, body);
      if (resp.ok) localStorage.setItem("ft_model", found);
    }
  }
  if (!resp) throw new Error("目前找不到可用的 Gemini 模型,請稍後再試或先手動輸入。");
  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 403) throw new Error("API Key 可能有誤(HTTP " + resp.status + ")");
    if (resp.status === 429) throw new Error("已達免費額度上限,請稍後再試或手動輸入。");
    throw new Error("AI 分析失敗(HTTP " + resp.status + ")");
  }
  const json = await resp.json();
  let text = "";
  try { text = json.candidates[0].content.parts[0].text; } catch (e) { throw new Error("AI 回覆格式無法解析"); }
  text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  let r;
  try { r = JSON.parse(text); } catch (e) { throw new Error("AI 回覆格式無法解析,請再試一次"); }
  return {
    name: String(r.name || "餐點"),
    calories: Number(r.calories) || 0,
    carbs: Number(r.carbs) || 0,
    protein: Number(r.protein) || 0,
    fat: Number(r.fat) || 0,
    advice: String(r.advice || ""),
  };
}
$("mealSaveBtn").addEventListener("click", async () => {
  let thumb = null;
  if (mealImage) {
    // 縮小成清單縮圖以節省空間
    const img = new Image();
    img.src = mealImage.dataUrl;
    await new Promise((r) => { img.onload = r; });
    const c = document.createElement("canvas");
    const scale = Math.min(300 / Math.max(img.width, img.height), 1);
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    thumb = c.toDataURL("image/jpeg", 0.55);
  }
  await idbPut("meals", {
    date: todayStr(), ts: Date.now(), mealType: currentMealType,
    name: $("rName").value || "餐點",
    calories: Number($("rCal").value) || 0,
    carbs: Number($("rCarb").value) || 0,
    protein: Number($("rProtein").value) || 0,
    fat: Number($("rFat").value) || 0,
    advice: $("rAdvice").textContent || "",
    thumb,
  });
  $("mealDialog").close();
  toast("已記錄!");
  renderFood();
});

/* ==================================================
   重訓計時
================================================== */
const GYM_C = 704;
let gym = { phase: "idle", setNumber: 1, phaseStart: 0, lastSetDuration: 0, sets: [], notified: false };
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* 不支援就算了 */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && gym.phase !== "idle") keepAwake(true);
});
function beep(times) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.start(t); o.stop(t + 0.3);
    }
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
}
function restSeconds() { return Number($("gymRest").value) || 90; }
function gymTick() {
  const now = Date.now();
  const elapsed = (now - gym.phaseStart) / 1000;
  const ring = $("gymRing");
  if (gym.phase === "working") {
    $("gymTime").textContent = fmtMin(elapsed);
    ring.setAttribute("stroke", "var(--green)");
    ring.setAttribute("stroke-dashoffset", "0");
  } else if (gym.phase === "resting") {
    const remain = restSeconds() - elapsed;
    $("gymTime").textContent = fmtMin(Math.max(remain, 0));
    ring.setAttribute("stroke", remain > 10 ? "var(--blue)" : "var(--red)");
    ring.setAttribute("stroke-dashoffset", String(GYM_C * (1 - Math.max(remain, 0) / restSeconds())));
    if (remain <= 0 && !gym.notified) {
      gym.notified = true;
      $("gymPhaseLabel").textContent = "休息結束!";
      $("gymPhaseLabel").style.color = "var(--red)";
      beep(3);
    }
  }
}
setInterval(gymTick, 200);

function updateGymUI() {
  const main = $("gymMainBtn"), finish = $("gymFinishBtn");
  const label = $("gymPhaseLabel"), sub = $("gymSubLabel");
  label.style.color = "";
  if (gym.phase === "idle") {
    label.textContent = "準備好了嗎?";
    $("gymTime").textContent = "0:00";
    sub.textContent = "";
    $("gymRing").setAttribute("stroke-dashoffset", String(GYM_C));
    main.textContent = "▶ 開始第 " + gym.setNumber + " 組";
    main.style.background = "var(--green)";
    finish.style.display = gym.sets.length ? "block" : "none";
  } else if (gym.phase === "working") {
    label.textContent = "第 " + gym.setNumber + " 組進行中";
    sub.textContent = "";
    main.textContent = "⏸ 這組結束,開始休息";
    main.style.background = "var(--blue)";
    finish.style.display = "block";
  } else {
    label.textContent = "休息中";
    sub.textContent = "上一組做了 " + fmtMin(gym.lastSetDuration);
    main.textContent = "▶ 開始第 " + gym.setNumber + " 組";
    main.style.background = "var(--green)";
    finish.style.display = "block";
  }
}
function renderGymLog() {
  const el = $("gymLog");
  el.innerHTML = gym.sets.length === 0 ? '<p class="sub small">尚無紀錄</p>' :
    gym.sets.slice().reverse().map((s) =>
      `<div class="listitem"><div class="grow"><div class="name">${escapeHtml(s.name || "動作")} 第 ${s.set} 組</div></div>
       <div class="detail">做 ${fmtMin(s.duration)}・休 ${s.rest ? fmtMin(s.rest) : "--"}</div></div>`
    ).join("");
}
$("gymMainBtn").addEventListener("click", () => {
  const now = Date.now();
  if (gym.phase === "working") {
    // 結束這組 → 休息
    gym.lastSetDuration = (now - gym.phaseStart) / 1000;
    gym.sets.push({ name: $("gymExercise").value.trim(), set: gym.setNumber, duration: gym.lastSetDuration, rest: 0 });
    gym.setNumber++;
    gym.phase = "resting";
    gym.phaseStart = now;
    gym.notified = false;
  } else {
    // idle 或 resting → 開始下一組
    if (gym.phase === "resting" && gym.sets.length) {
      gym.sets[gym.sets.length - 1].rest = (now - gym.phaseStart) / 1000;
    }
    gym.phase = "working";
    gym.phaseStart = now;
    gym.notified = false;
    keepAwake(true);
  }
  updateGymUI();
  renderGymLog();
});
$("gymFinishBtn").addEventListener("click", async () => {
  if (gym.phase === "working") {
    gym.sets.push({ name: $("gymExercise").value.trim(), set: gym.setNumber, duration: (Date.now() - gym.phaseStart) / 1000, rest: 0 });
  }
  if (gym.sets.length) {
    await idbPut("workouts", { date: todayStr(), ts: Date.now(), sets: gym.sets });
    toast("已儲存本次訓練(" + gym.sets.length + " 組)");
  }
  gym = { phase: "idle", setNumber: 1, phaseStart: 0, lastSetDuration: 0, sets: [], notified: false };
  keepAwake(false);
  updateGymUI();
  renderGymLog();
});
(function initGymRest() {
  const sel = $("gymRest");
  [30, 45, 60, 90, 120, 150, 180, 240, 300].forEach((s) => {
    const o = document.createElement("option");
    o.value = s; o.textContent = fmtMin(s);
    sel.appendChild(o);
  });
  sel.value = String(getSettings().rest);
})();

/* ==================================================
   設定
================================================== */
function loadSettingsUI() {
  const s = getSettings();
  $("sBudget").value = s.budget; $("sCarb").value = s.carb;
  $("sProtein").value = s.protein; $("sFat").value = s.fat; $("sRest").value = s.rest;
  $("sApiKey").value = getApiKey();
}
$("sSaveBtn").addEventListener("click", () => {
  saveSettings({
    budget: Number($("sBudget").value) || DEFAULTS.budget,
    carb: Number($("sCarb").value) || DEFAULTS.carb,
    protein: Number($("sProtein").value) || DEFAULTS.protein,
    fat: Number($("sFat").value) || DEFAULTS.fat,
    rest: Number($("sRest").value) || DEFAULTS.rest,
  });
  $("gymRest").value = String(getSettings().rest);
  toast("設定已儲存");
  renderFood();
});
$("sApiSaveBtn").addEventListener("click", () => {
  localStorage.setItem("ft_apikey", $("sApiKey").value.trim());
  toast("API Key 已儲存(僅存於此裝置)");
});
$("exportBtn").addEventListener("click", async () => {
  const data = {
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    health: await idbAll("health"),
    meals: await idbAll("meals"),
    workouts: await idbAll("workouts"),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fittrack-backup-" + todayStr() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("wipeBtn").addEventListener("click", async () => {
  if (!confirm("確定要刪除所有資料?此動作無法復原。")) return;
  await Promise.all([idbClear("meals"), idbClear("health"), idbClear("workouts"), idbClear("hkworkouts")]);
  localStorage.removeItem("ft_settings");
  localStorage.removeItem("ft_apikey");
  loadSettingsUI();
  renderHealth(); renderFood();
  toast("已清除所有資料");
});

/* ============ 啟動 ============ */
(async function init() {
  await openDB();
  loadSettingsUI();
  updateGymUI();
  renderGymLog();
  await renderHealth();
  await renderFood();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
