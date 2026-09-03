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
const DEFAULTS = { budget: 2000, budgetTrain: 2200, budgetCardio: 2000, budgetRest: 1800, carb: 250, protein: 120, fat: 65, fiber: 25, rest: 90 };
function getSettings() {
  let s;
  try { s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("ft_settings") || "{}")); }
  catch (e) { s = Object.assign({}, DEFAULTS); }
  if (!s.days) {
    const base = Number(s.budgetTrain) || 2200;
    const mk = (b) => ({ kcal: b, carb: Math.round(s.carb * b / base), protein: s.protein, fat: Math.round(s.fat * b / base) });
    s.days = { train: mk(Number(s.budgetTrain) || 2200), cardio: mk(Number(s.budgetCardio) || 2000), rest: mk(Number(s.budgetRest) || 1800) };
  }
  return s;
}
function saveSettings(s) { localStorage.setItem("ft_settings", JSON.stringify(s)); }
const getApiKey = () => { try { return localStorage.getItem("ft_apikey") || ""; } catch (e) { return ""; } };

/* ---- 當日型態(重訓/有氧/休息)與對應目標 ---- */
const DAY_TYPE_NAMES = { train: "重訓日", cardio: "有氧日", rest: "休息日" };
/* ---- 運動簡記(每日一行) ---- */
function exNotes() {
  try { return JSON.parse(localStorage.getItem("ft_exlog") || "{}"); } catch (e) { return {}; }
}
function exNoteFor(d) { return exNotes()[d] || ""; }
function setExNote(d, text) {
  try { const m = exNotes(); if (text) m[d] = text; else delete m[d]; localStorage.setItem("ft_exlog", JSON.stringify(m)); } catch (e) {}
}
function dayTypeFor(date) {
  try { const m = JSON.parse(localStorage.getItem("ft_daytypes") || "{}"); return m[date] || "cardio"; }
  catch (e) { return "cardio"; }
}
function setDayType(date, type) {
  try { const m = JSON.parse(localStorage.getItem("ft_daytypes") || "{}"); m[date] = type; localStorage.setItem("ft_daytypes", JSON.stringify(m)); }
  catch (e) {}
}
function effectiveTargets(s, type) {
  const d = (s.days && (s.days[type] || s.days.cardio)) || { kcal: 2000, carb: 250, protein: 120, fat: 65 };
  return { budget: d.kcal, carb: d.carb, protein: d.protein, fat: d.fat, fiber: Number(s.fiber) || 25 };
}

/* ---- 身體數據(InBody) ---- */
function getProfile() {
  try { return JSON.parse(localStorage.getItem("ft_profile") || "{}"); } catch (e) { return {}; }
}
function saveProfile(p) { try { localStorage.setItem("ft_profile", JSON.stringify(p)); } catch (e) {} }
function profileText() {
  const p = getProfile();
  const parts = [];
  if (p.height) parts.push("身高 " + p.height + "cm");
  if (p.weight) parts.push("體重 " + p.weight + "kg");
  if (p.bodyFat) parts.push("體脂 " + p.bodyFat + "%");
  if (p.muscle) parts.push("骨骼肌 " + p.muscle + "kg");
  if (p.age) parts.push(p.age + "歲");
  if (p.gender) parts.push(p.gender);
  if (p.goal) parts.push("目標:" + p.goal);
  if (p.note) parts.push(p.note);
  return parts.length ? "我的身體數據:" + parts.join(",") + "。" : "";
}
function renderDayTypeSeg(active) {
  const el = $("dayTypeSeg");
  if (!el) return;
  el.innerHTML = ["train", "cardio", "rest"].map((k) =>
    '<button type="button" class="' + (k === active ? "on" : "") + '" data-k="' + k + '">' + DAY_TYPE_NAMES[k] + "</button>").join("");
  el.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { setDayType(todayStr(), b.dataset.k); renderFood(); }));
}

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
    if (btn.dataset.tab === "tab-food" || btn.dataset.tab === "tab-history") renderFood();
  });
});

/* ==================================================
   飲食分頁
================================================== */
const MEAL_TYPES = ["早餐", "午餐", "晚餐", "點心"];
let mealImages = []; // 同一餐的多張照片 [{dataUrl, base64}]
let mealCorrections = []; // 使用者對估算的補充修正
let editingMealId = null;      // 編輯既有紀錄時的 id

/* ---- 常用餐(localStorage) ---- */
function getFavs() {
  try { return JSON.parse(localStorage.getItem("ft_favorites") || "[]"); } catch (e) { return []; }
}
function saveFavs(list) { try { localStorage.setItem("ft_favorites", JSON.stringify(list.slice(0, 15))); } catch (e) {} }
function renderFavs(filter) {
  const el = $("favRow");
  if (!el) return;
  let favs = getFavs();
  favs.forEach((f, i) => { f._i = i; });
  favs.sort((a, b) => (b.count || 0) - (a.count || 0));
  $("favSearch").style.display = getFavs().length >= 6 ? "block" : "none";
  if (filter) favs = favs.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()));
  el.innerHTML = favs.length === 0 ? "" :
    favs.map((f) => { const i = f._i; return (
      '<button type="button" class="fav-chip" onclick="useFav(' + i + ')">' + escapeHtml(f.name)
      + ' <span style="color:var(--sub)">' + Math.round(f.calories) + '</span>'
      + '<span class="x" onclick="event.stopPropagation(); removeFav(' + i + ')">✕</span></button>'); }
    ).join("");
}
$("favSearch").addEventListener("input", () => renderFavs($("favSearch").value.trim()));
window.useFav = (i) => {
  const favs = getFavs();
  const f = favs[i];
  if (!f) return;
  f.count = (f.count || 0) + 1;
  saveFavs(favs);
  $("rName").value = f.name;
  $("rCal").value = Math.round(f.calories);
  $("rCarb").value = Math.round(f.carbs);
  $("rProtein").value = Math.round(f.protein);
  $("rFat").value = Math.round(f.fat);
  $("rFiber").value = Math.round(f.fiber || 0);
  $("rAdvice").textContent = "";
  lastAnalysisItems = f.items || [];
  $("rItems").innerHTML = renderItemsTable(lastAnalysisItems);
  $("mealResult").style.display = "block";
  $("mealSaveBtn").disabled = false;
  toast("已帶入「" + f.name + "」,按儲存即可");
};
window.removeFav = (i) => {
  const favs = getFavs();
  favs.splice(i, 1);
  saveFavs(favs);
  renderFavs();
};
$("favSaveBtn").addEventListener("click", () => {
  const name = $("rName").value.trim();
  const cal = Number($("rCal").value) || 0;
  if (!name || !cal) { toast("先有名稱與熱量才能存常用"); return; }
  const prev = getFavs().find((f) => f.name === name);
  const favs = getFavs().filter((f) => f.name !== name);
  favs.unshift({
    count: prev ? prev.count || 0 : 0,
    name,
    calories: cal,
    carbs: Number($("rCarb").value) || 0,
    protein: Number($("rProtein").value) || 0,
    fat: Number($("rFat").value) || 0,
    fiber: Number($("rFiber").value) || 0,
    items: lastAnalysisItems || [],
  });
  saveFavs(favs);
  renderFavs();
  toast("已存為常用 ☆");
});
let lastAnalysisItems = [];    // 這次分析的單項明細
let lastAnalysisResult = null; // 上次完整分析結果(供針對性修正)
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
  const dt = dayTypeFor(todayStr());
  const t = effectiveTargets(s, dt);
  renderDayTypeSeg(dt);
  const allMeals = await idbAll("meals");
  const meals = allMeals.filter((m) => m.date === todayStr());
  const healthAll = await idbAll("health");
  const weights = {};
  healthAll.forEach((h) => { if (h.weight) weights[h.date] = h.weight; });
  renderHistory(allMeals, s, weights);
  renderTodayExtras();
  try {
    if ($("weeklyOut") && !$("weeklyOut").textContent) {
      const w = (await idbAll("coach")).filter((c) => c.kind === "weekly").sort((a, b) => b.ts - a.ts);
      if (w.length) $("weeklyOut").textContent = w[0].text;
    }
  } catch (e) {}
  if (!dietThread.length) await loadDietThread(); else renderDietChat();
  const sum = (k) => meals.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const cal = sum("calories"), remaining = t.budget - cal;

  const C = 490;
  const ratio = Math.min(cal / Math.max(t.budget, 1), 1);
  const ring = $("budgetRing");
  ring.setAttribute("stroke-dashoffset", String(C * (1 - ratio)));
  ring.setAttribute("stroke", remaining >= 0 ? "var(--green)" : "var(--red)");
  $("ringTitle").textContent = remaining >= 0 ? "還可以吃" : "已超過";
  $("ringValue").textContent = String(Math.abs(Math.round(remaining)));
  $("ringValue").style.color = remaining >= 0 ? "" : "var(--red)";
  $("budgetSummary").textContent = DAY_TYPE_NAMES[dt] + "額度 " + t.budget + " kcal・已吃 " + Math.round(cal) + " kcal";

  const macros = [
    ["碳水", sum("carbs"), t.carb, "var(--orange)"],
    ["蛋白質", sum("protein"), t.protein, "var(--blue)"],
    ["脂肪", sum("fat"), t.fat, "var(--ochre)"],
    ["纖維", sum("fiber"), t.fiber, "var(--teal)"],
  ];
  $("macroRow").innerHTML = macros.map(([t, v, target, color]) =>
    `<div class="macro"><div class="sub small">${t}</div><b>${Math.round(v)}g</b>
     <div class="bar"><i style="width:${Math.min(v / Math.max(target, 1) * 100, 100)}%; background:${color}"></i></div>
     <div class="sub" style="font-size:11px">目標 ${target}g</div></div>`
  ).join("");

  // 連續記錄天數
  const dateSet = new Set(allMeals.map((m) => m.date));
  let streak = 0;
  let cursor = new Date();
  if (!dateSet.has(todayStr())) cursor = new Date(Date.now() - 86400000);
  for (;;) {
    const ds = cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0") + "-" + String(cursor.getDate()).padStart(2, "0");
    if (!dateSet.has(ds)) break;
    streak++;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  $("streakLine").textContent = streak >= 2 ? "連續記錄 " + streak + " 天" : "";

  meals.sort((a, b) => b.ts - a.ts);
  $("mealList").innerHTML = meals.length === 0 ? '<p class="sub small">還沒有紀錄,按上面「記錄一餐」吧!</p>' :
    meals.map((m) =>
      `<div class="listitem" style="cursor:pointer" onclick="editMeal(${m.id})">
        ${m.thumb ? `<img src="${m.thumb}" alt="">` : '<span class="noimg">無圖</span>'}
        <div class="grow">
          <div class="name">${m.mealType}・${escapeHtml(m.name)}</div>
          <div class="detail">碳 ${Math.round(m.carbs)}g・蛋 ${Math.round(m.protein)}g・脂 ${Math.round(m.fat)}g・纖 ${Math.round(m.fiber || 0)}g</div>
          ${m.items && m.items.length ? `<div class="detail">${m.items.map((i) => escapeHtml(i.name) + " " + Math.round(i.calories)).join("・")} kcal</div>` : ""}
          ${m.advice ? `<div class="advice">${escapeHtml(m.advice)}</div>` : ""}
        </div>
        <div><div class="kcal">${Math.round(m.calories)} kcal</div>
        <button class="secondary" style="padding:4px 10px; font-size:12px; margin-top:4px" onclick="event.stopPropagation(); deleteMeal(${m.id})">刪除</button></div>
      </div>`
    ).join("");
}
function renderItemsTable(items) {
  if (!items || !items.length) return "";
  return '<table class="items"><tr><th>食物</th><th>kcal</th><th>碳</th><th>蛋</th><th>脂</th><th>纖</th></tr>'
    + items.map((i) =>
      "<tr><td>" + escapeHtml(i.name) + "</td><td>" + Math.round(i.calories) + "</td><td>"
      + Math.round(i.carbs) + "</td><td>" + Math.round(i.protein) + "</td><td>" + Math.round(i.fat)
      + "</td><td>" + Math.round(i.fiber || 0) + "</td></tr>"
    ).join("") + "</table>";
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
window.deleteMeal = async (id) => {
  await idbDel("meals", id);
  renderFood();
};


/* ---------- 歷史折線圖 ---------- */
let chartDaySums = {};
function renderHistoryChart(days, byDay, s, sumK, weights) {
  const card = $("historyChartCard");
  if (!card) return;
  if (days.length < 2) { card.style.display = "none"; return; }
  card.style.display = "block";
  const data = days.slice(0, 14).slice().reverse(); // 由舊到新
  chartDaySums = {};
  data.forEach((d) => {
    const arr = byDay[d];
    chartDaySums[d] = {
      cal: Math.round(sumK(arr, "calories")),
      carb: Math.round(sumK(arr, "carbs")),
      pro: Math.round(sumK(arr, "protein")),
      fat: Math.round(sumK(arr, "fat")),
      budget: effectiveTargets(s, dayTypeFor(d)).budget,
      n: arr.length,
    };
  });
  const W = 330, H = 150, pL = 36, pR = 10, pT = 12, pB = 20;
  const vals = data.map((d) => chartDaySums[d].cal);
  const buds = data.map((d) => chartDaySums[d].budget);
  const maxY = Math.max.apply(null, vals.concat(buds)) * 1.15 || 1;
  const x = (i) => pL + (W - pL - pR) * (data.length === 1 ? 0.5 : i / (data.length - 1));
  const y = (v) => pT + (H - pT - pB) * (1 - v / maxY);
  const pts = data.map((d, i) => x(i) + "," + y(chartDaySums[d].cal)).join(" ");
  const budPts = data.map((d, i) => x(i) + "," + y(chartDaySums[d].budget)).join(" ");
  const gridVals = [Math.round(maxY / 2 / 100) * 100, Math.round(maxY / 1.15 / 100) * 100];
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%; height:auto; display:block">';
  gridVals.forEach((g) => {
    svg += '<line x1="' + pL + '" y1="' + y(g) + '" x2="' + (W - pR) + '" y2="' + y(g) + '" stroke="var(--line)" stroke-width="1"/>'
      + '<text x="' + (pL - 4) + '" y="' + (y(g) + 3) + '" text-anchor="end" font-size="9" fill="var(--sub)">' + g + '</text>';
  });
  svg += '<polyline points="' + budPts + '" fill="none" stroke="var(--sub)" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"/>';
  svg += '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
  data.forEach((d, i) => {
    const over = chartDaySums[d].cal > chartDaySums[d].budget;
    svg += '<circle id="pt-' + d + '" cx="' + x(i) + '" cy="' + y(chartDaySums[d].cal) + '" r="5.5" fill="var(--card)" '
      + 'stroke="' + (over ? "var(--red)" : "var(--accent)") + '" stroke-width="2" style="cursor:pointer" '
      + 'onclick="selectChartDay(\'' + d + '\')"/>';
    if (i === 0 || i === data.length - 1) {
      svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9" fill="var(--sub)">'
        + d.slice(5).replace("-", "/") + '</text>';
    }
  });
  const wDays = data.filter((d) => weights[d]);
  if (wDays.length >= 1) {
    const wVals = wDays.map((d) => weights[d]);
    const wMin = Math.min.apply(null, wVals) - 1, wMax = Math.max.apply(null, wVals) + 1;
    const wy = (v) => pT + (H - pT - pB) * (1 - (v - wMin) / (wMax - wMin || 1));
    const wPts = wDays.map((d) => x(data.indexOf(d)) + "," + wy(weights[d])).join(" ");
    if (wDays.length > 1) {
      svg += '<polyline points="' + wPts + '" fill="none" stroke="var(--blue)" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.9"/>';
    }
    wDays.forEach((d) => {
      svg += '<rect x="' + (x(data.indexOf(d)) - 3) + '" y="' + (wy(weights[d]) - 3) + '" width="6" height="6" rx="1.5" fill="var(--blue)"/>';
    });
    svg += '<text x="' + (W - pR) + '" y="' + (pT + 8) + '" text-anchor="end" font-size="9" fill="var(--blue)">體重 ' + wVals[wVals.length - 1] + 'kg</text>';
  }
  svg += '</svg>';
  $("historyChart").innerHTML = svg;
  renderHistoryChart._weights = weights;
}
window.selectChartDay = (d) => {
  const v = chartDaySums[d];
  if (!v) return;
  $("chartInfo").innerHTML = "<b>" + d.slice(5).replace("-", "/") + "(" + weekdayName(d) + ")</b>・"
    + v.n + " 餐・<b>" + v.cal + "</b> / " + v.budget + " kcal"
    + (v.cal > v.budget ? '<span style="color:var(--red)">(超標)</span>' : "(達標)")
    + "<br>碳水 " + v.carb + "g・蛋白質 " + v.pro + "g・脂肪 " + v.fat + "g"
    + ((renderHistoryChart._weights || {})[d] ? "・體重 " + renderHistoryChart._weights[d] + "kg" : "");
  if (!expandedDays.has(d)) window.toggleDay(d);
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
function renderHistory(allMeals, s, weights) {
  const el = $("historyList");
  if (!el) return;
  const today = todayStr();
  const byDay = {};
  allMeals.forEach((m) => {
    if (m.date === today) return;
    (byDay[m.date] = byDay[m.date] || []).push(m);
  });
  const days = Object.keys(byDay).sort().reverse().slice(0, 30);
  const sumK = (arr, k) => arr.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  renderHistoryChart(days, byDay, s, sumK, weights || {});
  if (days.length === 0) {
    el.innerHTML = '<p class="sub small">記錄幾天後,這裡會顯示每天的狀況</p>';
    return;
  }
  const avg = Math.round(days.reduce((a, d) => a + sumK(byDay[d], "calories"), 0) / days.length);
  let html = '<p class="sub small" style="margin:2px 0 8px">近 ' + days.length + ' 天平均每日 <b>' + avg + '</b> kcal</p>';
  for (const d of days) {
    const arr = byDay[d].sort((a, b) => a.ts - b.ts);
    const cal = Math.round(sumK(arr, "calories"));
    const dayBudget = effectiveTargets(s, dayTypeFor(d)).budget;
    const over = cal > dayBudget;
    const open = expandedDays.has(d);
    const pct = Math.min(cal / Math.max(dayBudget, 1) * 100, 100);
    html += '<div class="listitem" style="cursor:pointer" onclick="toggleDay(\'' + d + '\')">'
      + '<div class="grow"><div class="name"><span id="arrow-' + d + '">' + (open ? "▾" : "▸") + '</span> '
      + d.slice(5).replace("-", "/") + "(" + weekdayName(d) + ")"
      + (over ? '<span class="pill" style="color:var(--red)">超標</span>' : '<span class="pill" style="color:var(--green)">達標</span>') + '</div>'
      + '<div class="detail">' + arr.length + ' 餐・碳 ' + Math.round(sumK(arr, "carbs")) + 'g・蛋 ' + Math.round(sumK(arr, "protein")) + 'g・脂 ' + Math.round(sumK(arr, "fat")) + 'g・纖 ' + Math.round(sumK(arr, "fiber")) + 'g</div>'
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

/* ---------- 體重 & 運動簡記 ---------- */
async function renderTodayExtras() {
  const h = await idbGet("health", todayStr());
  if ($("wNum") && !$("wNum").value && h && h.weight) $("wNum").value = h.weight;
  if ($("exNote") && !$("exNote").value) $("exNote").value = exNoteFor(todayStr());
  if ($("waterVal")) $("waterVal").textContent = ((h && Number(h.water)) || 0) + " / 2000 ml";
}
async function adjustWater(delta) {
  const rec = (await idbGet("health", todayStr())) || { date: todayStr() };
  rec.water = Math.max(0, (Number(rec.water) || 0) + delta);
  await idbPut("health", rec);
  $("waterVal").textContent = rec.water + " / 2000 ml";
}
$("wPlus").addEventListener("click", () => adjustWater(250));
$("wMinus").addEventListener("click", () => adjustWater(-250));

$("wSaveBtn").addEventListener("click", async () => {
  const v = Number($("wNum").value);
  if (!v) { toast("先輸入體重"); return; }
  const rec = (await idbGet("health", todayStr())) || { date: todayStr() };
  rec.weight = v;
  await idbPut("health", rec);
  toast("體重已記錄 " + v + " kg");
  renderFood();
});
$("exSaveBtn").addEventListener("click", () => {
  setExNote(todayStr(), $("exNote").value.trim());
  toast("已記錄今天的運動");
});

/* ---------- AI 週報 ---------- */
$("weeklyBtn").addEventListener("click", async () => {
  const key = getApiKey();
  if (!key) { $("weeklyStatus").textContent = "請先到「設定」貼上 Gemini API Key。"; return; }
  const btn = $("weeklyBtn");
  btn.disabled = true;
  $("weeklyStatus").textContent = "AI 整理近 7 天中…";
  try {
    const s = getSettings();
    const meals = await idbAll("meals");
    const healthAll = await idbAll("health");
    const exm = exNotes();
    const lines = [];
    for (let o = 6; o >= 0; o--) {
      const t = new Date(Date.now() - o * 86400000);
      const d = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
      const arr = meals.filter((m) => m.date === d);
      const tg = effectiveTargets(s, dayTypeFor(d));
      const sum = (k) => Math.round(arr.reduce((a, m) => a + (Number(m[k]) || 0), 0));
      const hw = healthAll.find((x) => x.date === d);
      lines.push(d.slice(5) + "(" + DAY_TYPE_NAMES[dayTypeFor(d)] + "):"
        + (arr.length ? sum("calories") + "/" + tg.budget + "kcal,碳" + sum("carbs") + "蛋" + sum("protein") + "脂" + sum("fat") + "纖" + sum("fiber")
          + ",吃了" + arr.map((m) => m.name).join("、")
          : "無紀錄")
        + (hw && hw.weight ? ",體重" + hw.weight : "")
        + (exm[d] ? ",運動:" + exm[d] : ""));
    }
    const prompt = "你是專業營養師。" + profileText()
      + "以下是我近 7 天的飲食紀錄(實際/目標):\n" + lines.join("\n")
      + "\n請用繁體中文,不用任何 markdown 符號,分四段,各段以下列標題開頭:\n"
      + "本週總評:(整體吃得如何,2-3句,語氣像朋友)\n"
      + "數字重點:(平均熱量與目標差多少、蛋白質達成率、體重變化)\n"
      + "最大地雷:(這週最拖後腿的食物或習慣,點名它)\n"
      + "下週重點:(只給一個最重要的改變,講清楚怎麼做)";
    const text = (await geminiRequestText(key, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    })).trim();
    $("weeklyOut").textContent = text;
    $("weeklyStatus").textContent = "";
    await idbPut("coach", { date: todayStr(), ts: Date.now(), kind: "weekly", text });
  } catch (err) {
    $("weeklyStatus").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- AI 營養師:可對話 ---------- */
let dietThread = [];
let dietChatRecId = null;
function renderDietChat() {
  const el = $("dietChatLog");
  if (!el) return;
  el.innerHTML = dietThread.map((m) =>
    m.role === "user"
      ? '<div class="chat-u">' + escapeHtml(m.text) + "</div>"
      : '<div class="chat-m">' + escapeHtml(m.text) + "</div>"
  ).join("") || '<p class="sub small">按下方按鈕請營養師評今天的飲食,或直接輸入問題(它知道你今天吃了什麼、練了什麼、身體數據)。</p>';
}
async function loadDietThread() {
  try {
    const recs = (await idbAll("coach")).filter((c) => c.date === todayStr() && c.kind === "dietchat");
    if (recs.length) { dietThread = recs[recs.length - 1].msgs || []; dietChatRecId = recs[recs.length - 1].id; }
  } catch (e) {}
  renderDietChat();
}
async function saveDietThread() {
  try {
    if (dietChatRecId) {
      const r = await idbGet("coach", dietChatRecId);
      if (r) { r.msgs = dietThread; r.ts = Date.now(); await idbPut("coach", r); return; }
    }
    dietChatRecId = await idbPut("coach", { date: todayStr(), ts: Date.now(), kind: "dietchat", msgs: dietThread });
  } catch (e) {}
}
async function dietBaseTurn() {
  return "你是專業健身營養師,用繁體中文口語回答,精簡具體,不用任何 markdown 符號。以下是我目前的即時數據:"
    + await buildDietContext()
    + "請根據這些資料與我對話,提到食物時給具體品項與份量(例如便利商店買什麼)。";
}
async function sendDietChat(question) {
  const key = getApiKey();
  if (!key) { $("dietCoachStatus").textContent = "請先到「設定」貼上 Gemini API Key。"; return; }
  $("dietCoachStatus").textContent = "營養師思考中…";
  $("dietChatSend").disabled = true; $("dietCoachBtn").disabled = true;
  dietThread.push({ role: "user", text: question });
  renderDietChat();
  try {
    const contents = [
      { role: "user", parts: [{ text: await dietBaseTurn() }] },
      { role: "model", parts: [{ text: "了解,我已掌握你今天的數據,請說。" }] },
    ].concat(dietThread.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] })));
    const text = (await geminiRequestText(key, { contents, generationConfig: { temperature: 0.5 } })).trim();
    dietThread.push({ role: "model", text });
    $("dietCoachStatus").textContent = "";
    await saveDietThread();
  } catch (err) {
    dietThread.pop();
    $("dietCoachStatus").textContent = err.message;
  } finally {
    $("dietChatSend").disabled = false; $("dietCoachBtn").disabled = false;
    renderDietChat();
  }
}
$("dietChatSend").addEventListener("click", () => {
  const q = $("dietChatInput").value.trim();
  if (!q) return;
  $("dietChatInput").value = "";
  sendDietChat(q);
});
$("dietCoachBtn").addEventListener("click", () => {
  dietThread = [];
  dietChatRecId = null;
  sendDietChat("請評今天到目前為止的飲食(品質、與目標的缺口),並給接下來的具體進食建議。");
});

/* ---------- 新增一餐 ---------- */
function renderMealTypeSeg() {
  $("mealTypeSeg").innerHTML = MEAL_TYPES.map((t) =>
    `<button type="button" class="${t === currentMealType ? "on" : ""}" data-t="${t}">${t}</button>`).join("");
  $("mealTypeSeg").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { currentMealType = b.dataset.t; renderMealTypeSeg(); }));
}
window.editMeal = async (id) => {
  const m = await idbGet("meals", id);
  if (!m) return;
  editingMealId = id;
  $("mealDate").value = m.date;
  mealImages = m.thumb ? [{ dataUrl: m.thumb, base64: m.thumb.split(",")[1] }] : [];
  mealCorrections = [];
  lastAnalysisItems = m.items || [];
  currentMealType = m.mealType;
  renderMealTypeSeg();
  renderMealPreviews();
  $("mealError").textContent = "";
  $("descInput").value = "";
  $("rName").value = m.name;
  $("rCal").value = Math.round(m.calories);
  $("rCarb").value = Math.round(m.carbs);
  $("rProtein").value = Math.round(m.protein);
  $("rFat").value = Math.round(m.fat);
  $("rFiber").value = Math.round(m.fiber || 0);
  $("rAdvice").textContent = m.advice || "";
  lastAnalysisResult = { name: m.name, calories: m.calories, carbs: m.carbs, protein: m.protein, fat: m.fat, fiber: m.fiber || 0, items: m.items || [] };
  $("rItems").innerHTML = renderItemsTable(lastAnalysisItems);
  $("mealResult").style.display = "block";
  $("mealSaveBtn").disabled = false;
  $("mealDialog").showModal();
  setTimeout(() => { try { document.activeElement.blur(); } catch (e) {} }, 60);
};

$("addMealBtn").addEventListener("click", () => {
  editingMealId = null;
  $("mealDate").value = todayStr();
  lastAnalysisItems = [];
  lastAnalysisResult = null;
  $("rItems").innerHTML = "";
  mealImages = [];
  mealCorrections = [];
  currentMealType = defaultMealType();
  renderMealTypeSeg();
  renderFavs();
  renderMealPreviews();
  $("mealResult").style.display = "none";
  $("mealError").textContent = "";
  $("mealSaveBtn").disabled = true;
  ["rName", "rCal", "rCarb", "rProtein", "rFat"].forEach((id) => { $(id).value = ""; });
  $("rAdvice").textContent = "";
  $("descInput").value = "";
  $("mealDialog").showModal();
  setTimeout(() => { try { document.activeElement.blur(); } catch (e) {} }, 60);
});
$("mealCancelBtn").addEventListener("click", () => $("mealDialog").close());
$("mealCloseBtn").addEventListener("click", () => $("mealDialog").close());
$("takePhotoBtn").addEventListener("click", () => $("mealPhoto").click());
$("pickPhotoBtn").addEventListener("click", () => $("mealAlbum").click());
[$("mealPhoto"), $("mealAlbum")].forEach((inp) =>
  inp.addEventListener("change", async (e) => {
    for (const f of Array.from(e.target.files || [])) {
      try { mealImages.push(await resizeImage(f, 768)); } catch (err) {}
    }
    mealCorrections = [];
    renderMealPreviews();
    e.target.value = "";
  }));
function renderMealPreviews() {
  const el = $("mealPreviews");
  el.innerHTML = mealImages.map((im, i) =>
    '<img src="' + im.dataUrl + '" alt="照片' + (i + 1) + '" onclick="removeMealImage(' + i + ')">').join("");
  $("previewHint").style.display = mealImages.length ? "block" : "none";
  $("analyzeBtn").style.display = mealImages.length ? "block" : "none";
}
window.removeMealImage = (i) => {
  mealImages.splice(i, 1);
  renderMealPreviews();
};
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
      const dataUrl = canvas.toDataURL("image/jpeg", 0.62);
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
  const desc = $("descInput").value.trim();
  if (!mealImages.length && !desc) { $("mealError").textContent = "請先拍照、選照片,或用文字描述你吃了什麼。"; return; }
  const key = getApiKey();
  if (!key) { $("mealError").textContent = "請先到「設定」貼上 Gemini API Key(免費申請),或改用手動輸入。"; return; }
  const btn = $("analyzeBtn");
  btn.disabled = true; $("fixBtn").disabled = true; $("descBtn").disabled = true;
  btn.textContent = "AI 分析中…";
  $("descBtn").textContent = "AI 估算中…";
  $("mealError").textContent = "";
  try {
    const ctx = await buildDietContext();
    let r = null, lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        r = await analyzeMeal(mealImages.map((im) => im.base64), desc, key, ctx, mealCorrections, lastAnalysisResult);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (!(e.status === 503 || e.status === 500 || e.status === 429)) break;
        if (attempt < 3) {
          $("mealError").textContent = "伺服器忙碌,自動重試中(" + attempt + "/3)…請不要關閉畫面";
          await new Promise((res) => setTimeout(res, 1800));
        }
      }
    }
    if (lastErr) throw lastErr;
    lastAnalysisResult = r;
    lastAnalysisItems = r.items || [];
    $("rName").value = r.name;
    $("rCal").value = Math.round(r.calories);
    $("rCarb").value = Math.round(r.carbs);
    $("rProtein").value = Math.round(r.protein);
    $("rFat").value = Math.round(r.fat);
    $("rFiber").value = Math.round(r.fiber || 0);
    $("rAdvice").textContent = r.advice || "";
    $("rItems").innerHTML = renderItemsTable(lastAnalysisItems);
    $("mealError").textContent = "";
    $("mealResult").style.display = "block";
    $("mealSaveBtn").disabled = false;
  } catch (err) {
    $("mealError").textContent = err.message;
  } finally {
    btn.disabled = false; $("fixBtn").disabled = false; $("descBtn").disabled = false;
    btn.textContent = "AI 分析熱量";
    $("descBtn").textContent = "AI 用文字估算";
  }
}
$("descBtn").addEventListener("click", () => runAnalysis());

/* 本地「記憶」:把近況整理成摘要一起給 AI,記憶本體只存在此裝置 */
async function buildDietContext() {
  try {
    const s = getSettings();
    const dt = dayTypeFor(todayStr());
    const t = effectiveTargets(s, dt);
    const all = await idbAll("meals");
    const today = todayStr();
    const tMeals = all.filter((m) => m.date === today);
    const sum = (arr, k) => arr.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    const cal = sum(tMeals, "calories");
    let ctx = profileText() + "今天是" + DAY_TYPE_NAMES[dt] + "。已吃 " + Math.round(cal) + " kcal(額度 " + t.budget + ",剩 " + Math.round(t.budget - cal) + ")"
      + ";碳水 " + Math.round(sum(tMeals, "carbs")) + "/" + t.carb + "g"
      + ";蛋白質 " + Math.round(sum(tMeals, "protein")) + "/" + t.protein + "g"
      + ";脂肪 " + Math.round(sum(tMeals, "fat")) + "/" + t.fat + "g"
      + ";膳食纖維 " + Math.round(sum(tMeals, "fiber")) + "/" + t.fiber + "g。";
    if (tMeals.length) ctx += "今天已吃:" + tMeals.map((m) => m.mealType + " " + m.name + "(" + Math.round(m.calories) + "kcal)").join("、") + "。";
    const days = {};
    all.forEach((m) => { if (m.date !== today) { days[m.date] = (days[m.date] || 0) + (Number(m.calories) || 0); } });
    const recent = Object.keys(days).sort().slice(-3);
    if (recent.length) {
      const avg = recent.reduce((a, d) => a + days[d], 0) / recent.length;
      ctx += "近 " + recent.length + " 天平均每日 " + Math.round(avg) + " kcal。";
    }
    const h = await idbGet("health", today);
    if (h && h.weight) ctx += "今日體重 " + h.weight + " kg。";
    if (h && h.water) ctx += "今日喝水 " + h.water + " ml。";
    const exn = exNoteFor(today);
    ctx += "今天運動:" + (exn || "還沒記錄") + "。";
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
async function analyzeMeal(base64s, desc, key, ctx, corrections, prev) {
  const n = (base64s || []).length;
  let prompt = (n > 1
    ? '你是專業營養師。以下 ' + n + ' 張照片屬於「同一餐」,可能是分開拍的食材或菜色,請把它們整合成一餐估算營養成分。'
    : n === 1
    ? '你是專業營養師。請分析這張餐點照片,估算整份餐點的營養成分。'
    : '你是專業營養師。使用者沒有拍照,請根據他的文字描述,用常見份量估算這一餐的營養成分。')
    + '請「只」回傳以下格式的 JSON,不要加任何其他文字:{"name":"整餐名稱(繁體中文)","items":[{"name":"單項食物或飲料名","calories":數字,"carbs":數字,"protein":數字,"fat":數字,"fiber":數字}],"calories":整餐總熱量,"carbs":數字,"protein":數字,"fat":數字,"fiber":數字,"advice":"一到兩句繁體中文的飲食建議"}。items 請把每樣食物/飲料分開列(例如三明治一項、拿鐵一項),讓使用者看出哪樣是熱量炸彈。calories 單位 kcal,carbs/protein/fat/fiber(膳食纖維) 單位公克。如果內容不是食物,name 填「非食物」,數值全填 0。'
    + "\n如果是有包裝的市售商品或連鎖店餐點(例如 7-11、全家、麥當勞、拿坡里、星巴克),請先用搜尋查該商品的官方營養標示,以官方標示數字為準,name 用商品正式名稱。";
  if (desc) prompt += (n ? "\n使用者補充說明:" : "\n他吃的內容:") + desc;
  if (ctx) prompt += "\n使用者近況(寫 advice 時參考):\n" + ctx;
  if (corrections && corrections.length) {
    if (prev) {
      prompt += "\n前次估算結果(JSON):" + JSON.stringify({
        name: prev.name, items: prev.items || [],
        calories: prev.calories, carbs: prev.carbs, protein: prev.protein, fat: prev.fat, fiber: prev.fiber || 0,
      });
    }
    prompt += "\n使用者的修正(可能只針對其中某幾項):\n- " + corrections.join("\n- ")
      + "\n重要:請「只」修改與修正內容直接相關的 items,其餘 items 的名稱與所有數值必須和前次估算完全相同地保留,最後重新加總 calories/carbs/protein/fat/fiber 與更新 advice。";
  }
  const parts = [{ text: prompt }];
  (base64s || []).forEach((b) => parts.push({ inline_data: { mime_type: "image/jpeg", data: b } }));
  const contents = [{ parts }];
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
    fiber: Number(r.fiber) || 0,
    advice: String(r.advice || ""),
    items: Array.isArray(r.items) ? r.items.map((i) => ({
      name: String(i.name || ""),
      calories: Number(i.calories) || 0,
      carbs: Number(i.carbs) || 0,
      protein: Number(i.protein) || 0,
      fat: Number(i.fat) || 0,
      fiber: Number(i.fiber) || 0,
    })) : [],
  };
}
$("mealSaveBtn").addEventListener("click", async () => {
  let thumb = null;
  if (mealImages.length && !editingMealId) {
    const img = new Image();
    img.src = mealImages[0].dataUrl;
    await new Promise((r) => { img.onload = r; });
    const c = document.createElement("canvas");
    const scale = Math.min(300 / Math.max(img.width, img.height), 1);
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    thumb = c.toDataURL("image/jpeg", 0.55);
  }
  const fields = {
    mealType: currentMealType,
    name: $("rName").value || "餐點",
    calories: Number($("rCal").value) || 0,
    carbs: Number($("rCarb").value) || 0,
    protein: Number($("rProtein").value) || 0,
    fat: Number($("rFat").value) || 0,
    fiber: Number($("rFiber").value) || 0,
    advice: $("rAdvice").textContent || "",
    items: lastAnalysisItems,
  };
  const pickedDate = ($("mealDate").value || todayStr()).slice(0, 10);
  const isToday = pickedDate === todayStr();
  if (editingMealId) {
    const m = await idbGet("meals", editingMealId);
    if (m) {
      Object.assign(m, fields);
      if (m.date !== pickedDate) {
        m.date = pickedDate;
        m.ts = isToday ? Date.now() : new Date(pickedDate + "T12:00:00").getTime();
      }
      await idbPut("meals", m);
    }
    toast("已更新!");
  } else {
    await idbPut("meals", Object.assign({
      date: pickedDate,
      ts: isToday ? Date.now() : new Date(pickedDate + "T12:00:00").getTime(),
      thumb,
    }, fields));
    toast(isToday ? "已記錄!" : "已補記到 " + pickedDate.slice(5).replace("-", "/"));
  }
  editingMealId = null;
  $("mealDialog").close();
  renderFood();
});

/* ==================================================
   設定
================================================== */
function loadSettingsUI() {
  const s = getSettings();
  const map = { T: "train", C: "cardio", R: "rest" };
  for (const k of ["T", "C", "R"]) {
    const d = s.days[map[k]];
    $("s" + k + "_kcal").value = d.kcal;
    $("s" + k + "_carb").value = d.carb;
    $("s" + k + "_pro").value = d.protein;
    $("s" + k + "_fat").value = d.fat;
  }
  $("sFiber").value = s.fiber || 25;
  $("sApiKey").value = getApiKey();
  const p = getProfile();
  $("pHeight").value = p.height || "";
  $("pWeight").value = p.weight || "";
  $("pFat").value = p.bodyFat || "";
  $("pMuscle").value = p.muscle || "";
  $("pAge").value = p.age || "";
  $("pGender").value = p.gender || "";
  $("pGoal").value = p.goal || "";
  $("pNote").value = p.note || "";
  try { $("targetReason").textContent = localStorage.getItem("ft_target_reason") || ""; } catch (e) {}
}
$("sSaveBtn").addEventListener("click", () => {
  const s = getSettings();
  const read = (id, fb) => Number($(id).value) || fb;
  s.days = {
    train:  { kcal: read("sT_kcal", 2200), carb: read("sT_carb", 270), protein: read("sT_pro", 130), fat: read("sT_fat", 70) },
    cardio: { kcal: read("sC_kcal", 2000), carb: read("sC_carb", 250), protein: read("sC_pro", 120), fat: read("sC_fat", 65) },
    rest:   { kcal: read("sR_kcal", 1800), carb: read("sR_carb", 200), protein: read("sR_pro", 120), fat: read("sR_fat", 55) },
  };
  s.fiber = read("sFiber", DEFAULTS.fiber);
  saveSettings(s);
  toast("設定已儲存");
  renderFood();
});
$("pSaveBtn").addEventListener("click", () => {
  saveProfile({
    height: $("pHeight").value.trim(), weight: $("pWeight").value.trim(),
    bodyFat: $("pFat").value.trim(), muscle: $("pMuscle").value.trim(),
    age: $("pAge").value.trim(), gender: $("pGender").value,
    goal: $("pGoal").value,
    note: $("pNote").value.trim(),
  });
  toast("身體數據已儲存(僅存於此裝置)");
});
$("aiTargetBtn").addEventListener("click", async () => {
  const key = getApiKey();
  const out = $("targetReason");
  if (!key) { out.textContent = "請先儲存 API Key。"; return; }
  const p = getProfile();
  if (!p.weight || !p.height) { out.textContent = "請先在「身體數據」填入至少身高與體重(體脂/年齡/性別越齊,算得越準)。"; return; }
  const btn = $("aiTargetBtn");
  btn.disabled = true;
  out.textContent = "AI 計算中…";
  try {
    const exm = exNotes();
    const exRecent = Object.keys(exm).sort().slice(-7).map((d) => d.slice(5) + " " + exm[d]).join(";");
    const prompt = "你是運動營養師。" + profileText()
      + "近期運動紀錄:" + (exRecent || "無")
      + '。請用 Mifflin-St Jeor 公式估算我的 BMR 與 TDEE,再幫我設定三種日子的每日目標(重訓日/有氧日/休息日)。'
      + '請「只」回傳以下格式的 JSON,不要加任何其他文字:'
      + '{"train":{"kcal":數字,"carb":數字,"protein":數字,"fat":數字},"cardio":{"kcal":數字,"carb":數字,"protein":數字,"fat":數字},"rest":{"kcal":數字,"carb":數字,"protein":數字,"fat":數字},"fiber":一日膳食纖維目標數字,"reason":"繁體中文:先說明 BMR/TDEE 估算結果、判斷的目標方向、蛋白質用多少 g/kg、三種日為何這樣配;最後附一份符合目標的一日示範菜單(早/午/晚/點心,含具體品項與份量)"}'
      + '。carb/protein/fat 單位公克。若我的資料有寫目標,請依目標調整熱量盈虧;若沒有寫目標,請依我的體脂率與骨骼肌量自行評估最適合的方向,並在 reason 開頭說明你判斷的目標。';
    const r = extractJson(await geminiRequestText(key, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, response_mime_type: "application/json" },
    }));
    const fill = (k, d) => {
      if (!d) return;
      $("s" + k + "_kcal").value = Math.round(d.kcal) || $("s" + k + "_kcal").value;
      $("s" + k + "_carb").value = Math.round(d.carb) || $("s" + k + "_carb").value;
      $("s" + k + "_pro").value = Math.round(d.protein) || $("s" + k + "_pro").value;
      $("s" + k + "_fat").value = Math.round(d.fat) || $("s" + k + "_fat").value;
    };
    fill("T", r.train); fill("C", r.cardio); fill("R", r.rest);
    if (r.fiber) $("sFiber").value = Math.round(r.fiber);
    const reason = String(r.reason || "");
    try { localStorage.setItem("ft_target_reason", reason); } catch (e) {}
    out.textContent = reason + "\n(已自動儲存,數字可直接修改後再按「儲存設定」)";
    $("sSaveBtn").click();
  } catch (err) {
    out.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$("pInbodyBtn").addEventListener("click", () => $("pInbodyFile").click());
$("pInbodyFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const key = getApiKey();
  if (!key) { $("pStatus").textContent = "請先儲存 API Key。"; return; }
  $("pStatus").textContent = "AI 讀取 InBody 報告中…";
  try {
    const img = await resizeImage(f, 1024);
    const prompt = '這是一張 InBody 或體組成分析報告的照片。請「只」回傳以下格式的 JSON,不要加任何其他文字:{"height":數字或null,"weight":數字或null,"bodyFat":數字或null,"muscle":數字或null,"age":數字或null,"gender":"男或女或空字串","note":"其他重要數值(如內臟脂肪、基礎代謝),繁體中文一句話"}。height 單位 cm、weight/muscle 單位 kg、bodyFat 為百分比數字。看不清楚的欄位填 null。';
    const text = await geminiRequestText(key, {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: img.base64 } }] }],
      generationConfig: { temperature: 0.1 },
    });
    const r = extractJson(text);
    if (r.height) $("pHeight").value = r.height;
    if (r.weight) $("pWeight").value = r.weight;
    if (r.bodyFat) $("pFat").value = r.bodyFat;
    if (r.muscle) $("pMuscle").value = r.muscle;
    if (r.age) $("pAge").value = r.age;
    if (r.gender) $("pGender").value = r.gender;
    if (r.note) $("pNote").value = r.note;
    $("pSaveBtn").click();
    $("pStatus").textContent = "已自動填入,請核對數字。";
  } catch (err) {
    $("pStatus").textContent = err.message;
  } finally {
    e.target.value = "";
  }
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
    coach: await idbAll("coach"),
    favorites: getFavs(),
    exlog: exNotes(),
    profile: getProfile(),
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
  ["ft_exlog", "ft_favorites", "ft_daytypes", "ft_profile", "ft_target_reason"].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  localStorage.removeItem("ft_settings");
  localStorage.removeItem("ft_apikey");
  loadSettingsUI();
  dietThread = []; dietChatRecId = null;
  renderFood();
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
  try {
    await openDBRetry(4);
  } catch (e) {
    toast("儲存空間啟動失敗,請完全關閉 App 後重開一次");
    return;
  }
  await renderFood();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
