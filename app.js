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
const getApiKey = () => { try { return localStorage.getItem("ft_apikey") || ""; } catch (e) { return ""; } };

/* ============ IndexedDB ============ */
let db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fittrack", 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("meals")) {
        const s = d.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
      }
      if (!d.objectStoreNames.contains("health")) d.createObjectStore("health", { keyPath: "date" });
      if (!d.objectStoreNames.contains("workouts")) d.createObjectStore("workouts", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("hkworkouts")) d.createObjectStore("hkworkouts", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("exercises")) d.createObjectStore("exercises", { keyPath: "id", autoIncrement: true });
      if (!d.objectStoreNames.contains("coach")) d.createObjectStore("coach", { keyPath: "id", autoIncrement: true });
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
    if (btn.dataset.tab === "tab-gym") renderGym();
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

    status.textContent = "完成!匯入 " + count + " 天的數據、" + workouts.length + " 次訓練。";
    toast("匯入完成");
    renderHealth();
  } catch (err) {
    status.textContent = "解析失敗:" + err.message;
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
let mealCorrections = []; // 使用者對估算的補充修正
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
  const allMeals = await idbAll("meals");
  const meals = allMeals.filter((m) => m.date === todayStr());
  renderHistory(allMeals, s);
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
    ["脂肪", sum("fat"), s.fat, "var(--ochre)"],
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
        ${m.thumb ? `<img src="${m.thumb}" alt="">` : '<span class="noimg">無圖</span>'}
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


/* ---------- 每日歷史 ---------- */
const expandedDays = new Set();
window.toggleDay = (date) => {
  if (expandedDays.has(date)) expandedDays.delete(date); else expandedDays.add(date);
  const el = document.getElementById("day-" + date);
  if (el) el.style.display = expandedDays.has(date) ? "block" : "none";
  const arrow = document.getElementById("arrow-" + date);
  if (arrow) arrow.textContent = expandedDays.has(date) ? "▾" : "▸";
};
function weekdayName(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
}
function renderHistory(allMeals, s) {
  const el = $("historyList");
  if (!el) return;
  const today = todayStr();
  const byDay = {};
  allMeals.forEach((m) => {
    if (m.date === today) return;
    (byDay[m.date] = byDay[m.date] || []).push(m);
  });
  const days = Object.keys(byDay).sort().reverse().slice(0, 30);
  if (days.length === 0) {
    el.innerHTML = '<p class="sub small">記錄幾天後,這裡會顯示每天的狀況</p>';
    return;
  }
  const sumK = (arr, k) => arr.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const avg = Math.round(days.reduce((a, d) => a + sumK(byDay[d], "calories"), 0) / days.length);
  let html = '<p class="sub small" style="margin:2px 0 8px">近 ' + days.length + ' 天平均每日 <b>' + avg + '</b> kcal・額度 ' + s.budget + ' kcal</p>';
  for (const d of days) {
    const arr = byDay[d].sort((a, b) => a.ts - b.ts);
    const cal = Math.round(sumK(arr, "calories"));
    const over = cal > s.budget;
    const open = expandedDays.has(d);
    const pct = Math.min(cal / Math.max(s.budget, 1) * 100, 100);
    html += '<div class="listitem" style="cursor:pointer" onclick="toggleDay(\'' + d + '\')">'
      + '<div class="grow"><div class="name"><span id="arrow-' + d + '">' + (open ? "▾" : "▸") + '</span> '
      + d.slice(5).replace("-", "/") + "(" + weekdayName(d) + ")"
      + (over ? '<span class="pill" style="color:var(--red)">超標</span>' : '<span class="pill" style="color:var(--green)">達標</span>') + '</div>'
      + '<div class="detail">' + arr.length + ' 餐・碳 ' + Math.round(sumK(arr, "carbs")) + 'g・蛋 ' + Math.round(sumK(arr, "protein")) + 'g・脂 ' + Math.round(sumK(arr, "fat")) + 'g</div>'
      + '<div class="bar" style="height:4px; background:var(--line); border-radius:2px; margin-top:5px; overflow:hidden">'
      + '<i style="display:block; height:100%; width:' + pct + '%; background:' + (over ? "var(--red)" : "var(--green)") + '"></i></div></div>'
      + '<div class="kcal" style="color:' + (over ? "var(--red)" : "inherit") + '">' + cal + '<br>kcal</div></div>'
      + '<div id="day-' + d + '" style="display:' + (open ? "block" : "none") + '; padding-left:10px">'
      + arr.map((m) =>
          '<div class="listitem">'
          + (m.thumb ? '<img src="' + m.thumb + '" alt="">' : '<span class="noimg">無圖</span>')
          + '<div class="grow"><div class="name" style="font-size:13px">' + m.mealType + '・' + escapeHtml(m.name) + '</div>'
          + '<div class="detail">碳 ' + Math.round(m.carbs) + 'g・蛋 ' + Math.round(m.protein) + 'g・脂 ' + Math.round(m.fat) + 'g</div></div>'
          + '<div class="kcal">' + Math.round(m.calories) + ' kcal</div></div>'
        ).join("")
      + '</div>';
  }
  el.innerHTML = html;
}

/* ---------- 新增一餐 ---------- */
function renderMealTypeSeg() {
  $("mealTypeSeg").innerHTML = MEAL_TYPES.map((t) =>
    `<button type="button" class="${t === currentMealType ? "on" : ""}" data-t="${t}">${t}</button>`).join("");
  $("mealTypeSeg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { currentMealType = b.dataset.t; renderMealTypeSeg(); }));
}
$("addMealBtn").addEventListener("click", () => {
  mealImage = null;
  mealCorrections = [];
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
    mealCorrections = [];
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
$("analyzeBtn").addEventListener("click", () => runAnalysis());
$("fixBtn").addEventListener("click", () => {
  const note = $("fixInput").value.trim();
  if (!note) { toast("先輸入要補充的內容"); return; }
  mealCorrections.push(note);
  $("fixInput").value = "";
  runAnalysis();
});

async function runAnalysis() {
  if (!mealImage) { $("mealError").textContent = "請先拍照或選一張餐點照片。"; return; }
  const key = getApiKey();
  if (!key) { $("mealError").textContent = "請先到「設定」貼上 Gemini API Key(免費申請),或改用手動輸入。注意:主畫面 App 和 Safari 的儲存是分開的,Key 要在這個 App 裡貼。"; return; }
  const btn = $("analyzeBtn");
  btn.disabled = true; $("fixBtn").disabled = true;
  btn.textContent = "AI 分析中…";
  $("mealError").textContent = "";
  try {
    const ctx = await buildDietContext();
    const r = await analyzeMeal(mealImage.base64, key, ctx, mealCorrections);
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
    btn.disabled = false; $("fixBtn").disabled = false;
    btn.textContent = "AI 分析熱量";
  }
}

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
/* 通用請求:模型自動輪替,回傳文字 */
async function geminiRequestText(key, body) {
  const cached = localStorage.getItem("ft_model");
  let candidates = MODEL_CANDIDATES.slice();
  if (cached) candidates = [cached].concat(candidates.filter((m) => m !== cached));
  let resp = null;
  let lastResp = null;
  for (const model of candidates) {
    try { resp = await geminiCall(model, key, body); }
    catch (e) { throw new Error("連線失敗,請確認網路。"); }
    if (resp.status === 404 || resp.status === 429 || resp.status === 500 || resp.status === 503) { lastResp = resp; resp = null; continue; }
    if (resp.ok) localStorage.setItem("ft_model", model);
    break;
  }
  if (resp === null) {
    const found = await listFlashModel(key);
    if (found) { resp = await geminiCall(found, key, body); if (resp.ok) localStorage.setItem("ft_model", found); }
  }
  if (!resp && lastResp) resp = lastResp;
  if (!resp) throw new Error("目前找不到可用的 Gemini 模型,請稍後再試。");
  if (!resp.ok) {
    const err = new Error(
      resp.status === 403 || resp.status === 401 ? "API Key 可能有誤(HTTP " + resp.status + ")" :
      resp.status === 429 ? "AI 額度暫時用完(HTTP 429)。等 1-2 分鐘再試,或改用手動輸入。若一直發生,請確認 API Key 與你的 Google AI Pro 訂閱是同一個 Google 帳號。" :
      resp.status === 404 ? "找不到可用模型(HTTP 404)。請到「設定」按「測試 API 連線」,把結果截圖回報。" :
      resp.status === 503 || resp.status === 500 ? "Google 伺服器暫時忙碌(HTTP " + resp.status + "),等幾秒再按一次即可。" :
      "AI 分析失敗(HTTP " + resp.status + ")");
    err.status = resp.status;
    throw err;
  }
  const json = await resp.json();
  try { return json.candidates[0].content.parts.map((p) => p.text || "").join(""); }
  catch (e) { throw new Error("AI 回覆格式無法解析"); }
}
function extractJson(text) {
  text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) text = text.slice(a, b + 1);
  return JSON.parse(text);
}
async function analyzeMeal(base64, key, ctx, corrections) {
  let prompt = '你是專業營養師。請分析這張餐點照片,估算整份餐點的營養成分。請「只」回傳以下格式的 JSON,不要加任何其他文字:{"name":"餐點名稱(繁體中文)","calories":數字,"carbs":數字,"protein":數字,"fat":數字,"advice":"一到兩句繁體中文的飲食建議"}。calories 單位 kcal,carbs/protein/fat 單位公克。如果照片不是食物,name 填「非食物」,數值全填 0。'
    + "\n如果照片是有包裝的市售商品或連鎖店餐點(例如 7-11、全家、麥當勞、星巴克),請先用搜尋查該商品的官方營養標示,以官方標示數字為準,name 用商品正式名稱。";
  if (ctx) prompt += "\n使用者近況(寫 advice 時參考):\n" + ctx;
  if (corrections && corrections.length) {
    prompt += "\n使用者對前次估算的補充修正,請完全以這些補充為準重新估算:\n- " + corrections.join("\n- ");
  }
  const contents = [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }];
  let text;
  try {
    // 先試帶 Google 搜尋(可查官方營養標示)
    text = await geminiRequestText(key, { contents, generationConfig: { temperature: 0.2 }, tools: [{ google_search: {} }] });
  } catch (e) {
    if (e && e.status) {
      // 帳號/模型不支援搜尋 → 退回一般模式
      text = await geminiRequestText(key, { contents, generationConfig: { temperature: 0.2, response_mime_type: "application/json" } });
    } else { throw e; }
  }
  let r;
  try { r = extractJson(text); } catch (e) { throw new Error("AI 回覆格式無法解析,請再試一次"); }
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
   運動紀錄 + AI 教練
================================================== */
const EX_TYPES = ["重訓", "跑步", "游泳", "騎車", "健走", "其他"];
const expandedExDays = new Set();
window.toggleExDay = (d) => {
  if (expandedExDays.has(d)) expandedExDays.delete(d); else expandedExDays.add(d);
  const el = document.getElementById("exday-" + d);
  if (el) el.style.display = expandedExDays.has(d) ? "block" : "none";
  const a = document.getElementById("exarrow-" + d);
  if (a) a.textContent = expandedExDays.has(d) ? "▾" : "▸";
};
window.deleteExercise = async (id) => { await idbDel("exercises", id); renderGym(); };

async function renderGym() {
  const all = await idbAll("exercises");
  const coach = await idbAll("coach");
  const today = todayStr();

  const t = all.filter((e) => e.date === today).sort((a, b) => a.ts - b.ts);
  $("exList").innerHTML = t.length === 0 ? '<p class="sub small">今天還沒記錄運動</p>' :
    t.map((e) =>
      '<div class="listitem"><div class="grow"><div class="name">' + e.type + '</div>'
      + '<div class="detail">' + escapeHtml(e.desc) + '</div></div>'
      + '<button class="secondary" style="padding:4px 10px; font-size:12px" onclick="deleteExercise(' + e.id + ')">刪除</button></div>'
    ).join("");

  const todayNotes = coach.filter((c) => c.date === today).sort((a, b) => b.ts - a.ts);
  if (todayNotes.length && !$("coachOutput").textContent) $("coachOutput").textContent = todayNotes[0].text;

  const byDay = {};
  all.forEach((e) => { if (e.date !== today) (byDay[e.date] = byDay[e.date] || { ex: [], note: "" }).ex.push(e); });
  coach.forEach((c) => {
    if (c.date === today) return;
    if (!byDay[c.date]) byDay[c.date] = { ex: [], note: "" };
    byDay[c.date].note = c.text;
  });
  const days = Object.keys(byDay).sort().reverse().slice(0, 30);
  $("exHistory").innerHTML = days.length === 0 ? '<p class="sub small">記錄幾天後,這裡會顯示每天的運動與 AI 建議</p>' :
    days.map((d) => {
      const g = byDay[d];
      const open = expandedExDays.has(d);
      return '<div class="listitem" style="cursor:pointer" onclick="toggleExDay(\'' + d + '\')">'
        + '<div class="grow"><div class="name"><span id="exarrow-' + d + '">' + (open ? "▾" : "▸") + '</span> '
        + d.slice(5).replace("-", "/") + "(" + weekdayName(d) + ")" + '</div>'
        + '<div class="detail">' + (g.ex.map((e) => e.type + " " + e.desc).join("、") || "無運動") + (g.note ? "・含 AI 建議" : "") + '</div></div></div>'
        + '<div id="exday-' + d + '" style="display:' + (open ? "block" : "none") + '; padding-left:10px">'
        + g.ex.map((e) => '<div class="listitem"><div class="grow"><div class="name" style="font-size:13px">' + e.type + '</div><div class="detail">' + escapeHtml(e.desc) + '</div></div></div>').join("")
        + (g.note ? '<p class="sub small" style="white-space:pre-wrap; color:var(--teal)">' + escapeHtml(g.note) + '</p>' : "")
        + '</div>';
    }).join("");
}
(function initExTypes() {
  const sel = $("exType");
  EX_TYPES.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o); });
})();
$("exAddBtn").addEventListener("click", async () => {
  const desc = $("exDesc").value.trim();
  if (!desc) { toast("先填一下運動內容吧"); return; }
  await idbPut("exercises", { date: todayStr(), ts: Date.now(), type: $("exType").value, desc });
  $("exDesc").value = "";
  toast("已記錄運動");
  renderGym();
});

/* 通用 Gemini 文字請求(模型自動輪替) */
async function geminiText(key, prompt) {
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } };
  const cached = localStorage.getItem("ft_model");
  let candidates = MODEL_CANDIDATES.slice();
  if (cached) candidates = [cached].concat(candidates.filter((m) => m !== cached));
  let resp = null;
  let lastResp = null;
  for (const model of candidates) {
    try { resp = await geminiCall(model, key, body); }
    catch (e) { throw new Error("連線失敗,請確認網路。"); }
    if (resp.status === 404 || resp.status === 429 || resp.status === 500 || resp.status === 503) { lastResp = resp; resp = null; continue; }
    if (resp.ok) localStorage.setItem("ft_model", model);
    break;
  }
  if (resp === null) {
    const found = await listFlashModel(key);
    if (found) { resp = await geminiCall(found, key, body); if (resp.ok) localStorage.setItem("ft_model", found); }
  }
  if (!resp && lastResp) resp = lastResp;
  if (!resp) throw new Error("目前找不到可用的 Gemini 模型,請稍後再試。");
  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 403) throw new Error("API Key 可能有誤(HTTP " + resp.status + ")");
    if (resp.status === 429) throw new Error("AI 額度暫時用完(HTTP 429),等 1-2 分鐘再試。");
    if (resp.status === 503 || resp.status === 500) throw new Error("Google 伺服器暫時忙碌(HTTP " + resp.status + "),等幾秒再按一次即可。");
    throw new Error("AI 分析失敗(HTTP " + resp.status + ")");
  }
  const json = await resp.json();
  try { return json.candidates[0].content.parts[0].text; }
  catch (e) { throw new Error("AI 回覆格式無法解析"); }
}

$("coachBtn").addEventListener("click", async () => {
  const key = getApiKey();
  if (!key) { $("coachStatus").textContent = "請先到「設定」貼上 Gemini API Key。"; return; }
  const btn = $("coachBtn");
  btn.disabled = true;
  $("coachStatus").textContent = "AI 教練分析中…";
  try {
    const all = await idbAll("exercises");
    const today = todayStr();
    const t = all.filter((e) => e.date === today);
    const recent = all.filter((e) => e.date !== today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
    const h = await idbGet("health", today);
    const prompt = "你是專業健身教練兼營養師。以下是我今天的資料:\n"
      + "【今日運動】" + (t.length ? t.map((e) => e.type + ":" + e.desc).join(";") : "還沒運動") + "\n"
      + "【近期運動】" + (recent.length ? recent.map((e) => e.date.slice(5) + " " + e.type + ":" + e.desc).join(";") : "無紀錄") + "\n"
      + (h && h.activeEnergy != null ? "【今日活動消耗】" + Math.round(h.activeEnergy) + " kcal\n" : "")
      + "【飲食狀況】" + await buildDietContext() + "\n"
      + "請用繁體中文回覆,不要用任何 markdown 符號,分三段,各段以下列標題開頭:\n"
      + "訓練評語:(2-3句,評今天的訓練安排與強度,搭配近期紀錄給下次建議)\n"
      + "營養缺口:(用具體數字說明今天蛋白質、碳水、脂肪、熱量各還差多少)\n"
      + "下一餐建議:(考慮運動內容與缺口,給出具體餐點與份量,例如便利商店或自助餐怎麼買)";
    const text = (await geminiText(key, prompt)).trim();
    $("coachOutput").textContent = text;
    $("coachStatus").textContent = "";
    await idbPut("coach", { date: today, ts: Date.now(), text });
    renderGym();
  } catch (err) {
    $("coachStatus").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
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
    main.textContent = "開始第 " + gym.setNumber + " 組";
    main.style.background = "var(--accent)";
    finish.style.display = gym.sets.length ? "block" : "none";
  } else if (gym.phase === "working") {
    label.textContent = "第 " + gym.setNumber + " 組進行中";
    sub.textContent = "";
    main.textContent = "這組結束,開始休息";
    main.style.background = "var(--accent-blue)";
    finish.style.display = "block";
  } else {
    label.textContent = "休息中";
    sub.textContent = "上一組做了 " + fmtMin(gym.lastSetDuration);
    main.textContent = "開始第 " + gym.setNumber + " 組";
    main.style.background = "var(--accent)";
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
  renderGym();
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
  const v = $("sApiKey").value.trim();
  let ok = false;
  try { localStorage.setItem("ft_apikey", v); ok = localStorage.getItem("ft_apikey") === v; } catch (e) { ok = false; }
  if (ok) {
    toast("API Key 已儲存 ✓");
  } else {
    alert("儲存失敗!瀏覽器可能封鎖了網站資料。請確認:1) 不是私密瀏覽 2) iPhone 設定 → Safari →「阻擋所有 Cookie」要關閉。");
  }
});
$("apiTestBtn").addEventListener("click", async () => {
  const key = getApiKey();
  const out = $("apiTestOut");
  if (!key) { out.textContent = "尚未儲存 API Key。"; return; }
  out.textContent = "測試中…";
  const lines = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key },
    });
    lines.push("模型清單:HTTP " + r.status);
    if (r.ok) {
      const j = await r.json();
      const names = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      lines.push("你的 Key 可用模型 " + names.length + " 個:");
      lines.push(names.slice(0, 8).join("\n") + (names.length > 8 ? "\n…" : ""));
    } else {
      lines.push((await r.text()).slice(0, 200));
    }
  } catch (e) { lines.push("模型清單:連線失敗 " + e.message); }
  for (const m of MODEL_CANDIDATES) {
    try {
      const r = await geminiCall(m, key, { contents: [{ parts: [{ text: "hi" }] }] });
      lines.push(m + " → HTTP " + r.status + (r.ok ? " ✓" : ""));
    } catch (e) { lines.push(m + " → 連線失敗"); }
    out.textContent = lines.join("\n");
  }
  out.textContent = lines.join("\n") + "\n\n把這個結果截圖回報,即可對症修正。";
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
  await Promise.all([idbClear("meals"), idbClear("health"), idbClear("workouts"), idbClear("hkworkouts"), idbClear("exercises"), idbClear("coach")]);
  localStorage.removeItem("ft_settings");
  localStorage.removeItem("ft_apikey");
  loadSettingsUI();
  renderHealth(); renderFood();
  toast("已清除所有資料");
});

/* ============ 啟動 ============ */
window.addEventListener("error", (e) => { try { toast("程式錯誤:" + (e.message || "未知")); } catch (_) {} });
function openDBRetry(times) {
  const attempt = () => Promise.race([
    openDB(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("開啟逾時")), 2500)),
  ]);
  let p = attempt();
  for (let i = 1; i < times; i++) p = p.catch(() => attempt());
  return p;
}
(async function init() {
  loadSettingsUI(); // 設定與 API Key 欄位不依賴資料庫,最先載入
  updateGymUI();
  renderGymLog();
  try {
    await openDBRetry(4);
  } catch (e) {
    toast("儲存空間啟動失敗,請完全關閉 App 後重開一次");
    return;
  }
  renderGym();
  await renderHealth();
  await renderFood();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
