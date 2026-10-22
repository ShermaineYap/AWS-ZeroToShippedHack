/* BanjirSiap frontend — vanilla JS, hash router, no build step. */
(() => {
  "use strict";
  const $app = document.getElementById("app");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bs:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bs:" + k, JSON.stringify(v)); } catch {} },
  };
  const navLang = (navigator.language || "en").slice(0, 2);
  let lang = store.get("lang", ["ms", "zh", "ta"].includes(navLang) ? navLang : "en");
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const h = (html) => { $app.innerHTML = html; $app.focus({ preventScroll: true }); window.scrollTo(0, 0); };
  const origin = location.origin + location.pathname.replace(/index\.html$/, "");
  let timers = [];
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  async function api(path, opts = {}) {
    const r = await fetch("/api" + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: { "content-type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.status);
    return data;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast(t("copied"));
  }
  const waLink = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
  const loadingView = (msg) => `<div class="loading"><div class="drop-anim"></div><p class="muted">${esc(msg || t("loading"))}</p></div>`;
  const errorView = (retryHash) => `<div class="card"><p>${esc(t("err"))}</p><a class="btn primary" href="${retryHash}">${esc(t("retry"))}</a></div>`;

  // ------------------------------------------------------------- chrome
  function renderChrome() {
    document.documentElement.lang = lang;
    document.getElementById("langs").innerHTML = Object.keys(I18N).map((l) =>
      `<button type="button" data-lang="${l}" aria-pressed="${l === lang}">${esc(I18N[l]._name)}</button>`).join("");
    document.getElementById("f-disclaimer").textContent = t("disclaimer");
    document.getElementById("f-privacy").textContent = t("privacy");
    document.getElementById("f-about").textContent = t("aboutLink");
    document.getElementById("f-made").textContent = t("madeWith");
  }
  document.getElementById("langs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]"); if (!b) return;
    lang = b.dataset.lang; store.set("lang", lang); renderChrome(); route();
  });

  // ------------------------------------------------------------- home
  const waves = `<svg class="waves" viewBox="0 0 1200 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C150 10 300 70 450 40 S750 10 900 40 1050 70 1200 40 V80 H0Z" fill="rgba(255,255,255,.12)"/><path d="M0 55 C200 30 350 80 550 55 S900 30 1200 55 V80 H0Z" fill="#f4f8fa"/></svg>`;
  async function home() {
    h(`
    <section class="hero">
      <span class="tag">🌧️ ${esc(t("tagline"))}</span>
      <h1>${esc(t("heroTitle"))}</h1>
      <p>${esc(t("heroSub"))}</p>
      <div class="cta">
        <a class="btn light" href="#/plan">${esc(t("ctaPlan"))} →</a>
        <button class="btn glass" id="demo">${esc(t("ctaDemo"))}</button>
      </div>
      ${waves}
    </section>
    <div class="grid3 feature-cards">
      <a class="card link" href="#/plan"><div class="icon">📋</div><h3>${esc(t("f1t"))}</h3><p class="muted">${esc(t("f1d"))}</p></a>
      <a class="card link" href="#/group/new"><div class="icon">🏘️</div><h3>${esc(t("f2t"))}</h3><p class="muted">${esc(t("f2d"))}</p></a>
      <a class="card link" href="#/photo"><div class="icon">📸</div><h3>${esc(t("f3t"))}</h3><p class="muted">${esc(t("f3d"))}</p></a>
    </div>
    <section class="section card">
      <h2>${esc(t("whyTitle"))}</h2>
      <p>${esc(t("whyBody"))}</p>
      <div class="actions"><a class="btn primary" href="#/plan">${esc(t("ctaPlan"))}</a><a class="btn ghost" href="#/group/new">${esc(t("ctaGroup"))}</a><a class="btn ghost" href="#/photo">${esc(t("ctaPhoto"))}</a></div>
    </section>
    <section class="section">
      <h2>${esc(t("statsTitle"))}</h2>
      <div class="stats card" id="stats">${["plans", "groups", "checkins", "photos"].map((k) => `<div class="stat"><b data-k="${k}">–</b><span>${esc(t("st" + k[0].toUpperCase() + k.slice(1)))}</span></div>`).join("")}</div>
    </section>`);
    document.getElementById("demo").onclick = startDemo;
    try {
      const s = await api("/stats");
      document.querySelectorAll("#stats [data-k]").forEach((el) => countUp(el, s[el.dataset.k] || 0));
    } catch {}
  }
  function countUp(el, n) {
    const start = performance.now();
    const step = (now) => { const p = Math.min((now - start) / 700, 1); el.textContent = Math.round(n * p).toLocaleString(); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  async function startDemo(e) {
    const b = e.currentTarget; b.disabled = true; b.textContent = t("loading");
    try {
      const g = await api("/demo", { body: { lang } });
      store.set("admin:" + g.id, g.adminKey);
      location.hash = `#/board/${g.id}/${g.adminKey}`;
    } catch { b.disabled = false; toast(t("err")); }
  }

  // ------------------------------------------------------------- plan wizard
  const STEPS = 6;
  let answers = store.get("answers", { adults: 2, children: 0, elderly: 0, mobility: false, pets: "", state: "Selangor", area: "" });
  let step = 0;
  const opt = (key, val, emoji, label) =>
    `<button type="button" class="opt" data-k="${key}" data-v="${val}" aria-pressed="${answers[key] === val}"><span class="e">${emoji}</span><span>${esc(label)}</span></button>`;
  function wizard() {
    const steps = [
      () => `<h2>${esc(t("q1"))}</h2>
        <label class="f" for="st">${esc(t("state"))}</label>
        <select id="st">${STATES.map((s) => `<option ${answers.state === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <label class="f" for="ar">${esc(t("areaPh"))}</label>
        <input id="ar" type="text" maxlength="60" value="${esc(answers.area)}" placeholder="Taman Sri Muda, Shah Alam">`,
      () => `<h2>${esc(t("q2"))}</h2><div class="options">
        ${opt("house", "landed1", "🏠", t("h_landed1"))}${opt("house", "landed2", "🏡", t("h_landed2"))}
        ${opt("house", "apt_low", "🏢", t("h_apt_low"))}${opt("house", "apt_high", "🏙️", t("h_apt_high"))}${opt("house", "kampung", "🛖", t("h_kampung"))}</div>`,
      () => `<h2>${esc(t("q3"))}</h2><div class="options">
        ${opt("terrain", "river", "🌊", t("t_river"))}${opt("terrain", "lowland", "⬇️", t("t_lowland"))}
        ${opt("terrain", "hill", "⛰️", t("t_hill"))}${opt("terrain", "unsure", "❔", t("t_unsure"))}</div>`,
      () => `<h2>${esc(t("q4"))}</h2><div class="options">
        ${opt("pastFlood", "often", "🔁", t("p_often"))}${opt("pastFlood", "once", "1️⃣", t("p_once"))}
        ${opt("pastFlood", "never", "✅", t("p_never"))}${opt("pastFlood", "unsure", "❔", t("p_unsure"))}</div>`,
      () => `<h2>${esc(t("q5"))}</h2>
        ${["adults", "children", "elderly"].map((k) => `<div class="counter"><span>${esc(t(k))}</span><div class="ctl">
          <button type="button" data-dec="${k}" aria-label="−">−</button><output id="o-${k}">${answers[k]}</output><button type="button" data-inc="${k}" aria-label="+">+</button></div></div>`).join("")}
        <label class="check"><input type="checkbox" id="mob" ${answers.mobility ? "checked" : ""}><span>${esc(t("mobility"))}</span></label>
        <input id="pets" type="text" maxlength="40" value="${esc(answers.pets)}" placeholder="${esc(t("petsPh"))}">`,
      () => `<h2>${esc(t("q6"))}</h2><div class="options">
        ${opt("vehicle", "car", "🚗", t("v_car"))}${opt("vehicle", "motorcycle", "🛵", t("v_moto"))}
        ${opt("vehicle", "both", "🚗🛵", t("v_both"))}${opt("vehicle", "none", "🚶", t("v_none"))}</div>`,
    ];
    const needs = [null, "house", "terrain", "pastFlood", null, "vehicle"][step];
    const canNext = !needs || answers[needs];
    h(`<div class="wiz">
      <div class="progress" aria-hidden="true"><i style="width:${((step + 1) / STEPS) * 100}%"></i></div>
      <p class="muted">${step + 1} / ${STEPS}</p>
      <div class="card">${steps[step]()}</div>
      <div class="navrow">
        <button class="btn ghost" id="prev" ${step === 0 ? "style='visibility:hidden'" : ""}>← ${esc(t("back"))}</button>
        <button class="btn primary" id="nxt" ${canNext ? "" : "disabled"}>${step === STEPS - 1 ? esc(t("generate")) + " ✨" : esc(t("next")) + " →"}</button>
      </div></div>`);
    const save = () => {
      const st = document.getElementById("st"); if (st) answers.state = st.value;
      const ar = document.getElementById("ar"); if (ar) answers.area = ar.value;
      const mob = document.getElementById("mob"); if (mob) answers.mobility = mob.checked;
      const pets = document.getElementById("pets"); if (pets) answers.pets = pets.value;
      store.set("answers", answers);
    };
    $app.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
      answers[b.dataset.k] = b.dataset.v; save();
      if (step < STEPS - 1) { step++; wizard(); } else wizard();
    });
    $app.querySelectorAll("[data-inc],[data-dec]").forEach((b) => b.onclick = () => {
      const k = b.dataset.inc || b.dataset.dec;
      answers[k] = Math.max(k === "adults" ? 1 : 0, Math.min(15, answers[k] + (b.dataset.inc ? 1 : -1)));
      document.getElementById("o-" + k).textContent = answers[k]; save();
    });
    document.getElementById("prev").onclick = () => { save(); step = Math.max(0, step - 1); wizard(); };
    document.getElementById("nxt").onclick = () => { save(); if (step < STEPS - 1) { step++; wizard(); } else generatePlan(); };
  }
  async function generatePlan() {
    const tips = [t("loading"), "🎒 " + t("goBag"), "🚨 " + t("ladder"), "🏘️ " + t("nextStep")];
    h(loadingView(tips[0]));
    let i = 0; const iv = setInterval(() => { const p = $app.querySelector(".loading p"); if (p) p.textContent = tips[++i % tips.length]; }, 1800); timers.push(iv);
    try {
      const r = await api("/plans", { body: { lang, answers } });
      store.set("plan:" + r.id, r);
      const mine = store.get("myPlans", []); mine.unshift(r.id); store.set("myPlans", mine.slice(0, 10));
      location.hash = "#/plan/" + r.id;
    } catch { h(errorView("#/plan")); } finally { clearInterval(iv); }
  }

  // ------------------------------------------------------------- plan result
  async function showPlan(id) {
    let r = store.get("plan:" + id);
    if (!r) { h(loadingView()); try { r = await api("/plans/" + id); store.set("plan:" + id, r); } catch { return h(errorView("#/plan")); } }
    const p = r.plan; const checked = store.get("bag:" + id, {});
    const contacts = [["999", t("c999")], ["112", t("c112")], ["994", t("c994")], ["991", t("c991")]];
    const lvLabel = { waspada: t("lv_waspada"), amaran: t("lv_amaran"), bahaya: t("lv_bahaya") };
    const bag = (p.goBag || []);
    h(`<div class="stack">
      <div class="card">
        <p class="muted">${esc(t("planTitle"))}${r.profile?.area ? " · " + esc(r.profile.area) : ""}${r.profile?.state ? ", " + esc(r.profile.state) : ""}</p>
        <h1 style="font-size:1.6rem">${esc(p.headline)}</h1>
        <div class="risk"><span class="badge ${esc(p.riskLevel)}">${esc(t("risk"))}: ${esc(t("risk_" + p.riskLevel))} · ${p.riskScore}/100</span>
          <div class="meter" aria-hidden="true"><i style="left:${p.riskScore}%"></i></div></div>
        <p class="muted small" style="margin-top:8px">${esc(t("riskNote"))}</p>
      </div>
      <div class="card leave"><h3>🚪 ${esc(t("leaveWhen"))}</h3><p style="margin:0;font-weight:600">${esc(p.leaveTrigger)}</p></div>
      <div class="card"><h2>${esc(t("ladder"))}</h2><div class="ladder">
        ${(p.stages || []).map((s) => `<div class="rung ${esc(s.level)}"><h3>${esc(lvLabel[s.level] || s.level)}</h3><ul>${(s.actions || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`).join("")}
      </div></div>
      <div class="grid2">
        <div class="card bag"><h2>🎒 ${esc(t("goBag"))}</h2>
          <div class="bagbar"><i id="bagbar"></i></div><p class="muted small" id="bagcount"></p>
          ${bag.map((g, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${checked[i] ? "checked" : ""}><span>${esc(g.item)}<span class="pill ${g.priority === "must" ? "must" : ""}">${esc(t(g.priority === "must" ? "must" : "should"))}</span><span class="why">${esc(g.why)}</span></span></label>`).join("")}
        </div>
        <div class="stack">
          ${(p.householdNotes || []).length ? `<div class="card"><h2>👨‍👩‍👧 ${esc(t("notes"))}</h2><ul>${p.householdNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
          <div class="card"><h2>🧹 ${esc(t("after"))}</h2><ul>${(p.afterFlood || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>
          <div class="card"><h2>📞 ${esc(t("contacts"))}</h2><div class="contacts">${contacts.map(([n, l]) => `<a class="contact" href="tel:${n}"><b>${n}</b><span>${esc(l)}</span></a>`).join("")}</div>
            <p class="small" style="margin:10px 0 0"><a href="https://publicinfobanjir.water.gov.my/" target="_blank" rel="noopener">🌊 ${esc(t("infobanjir"))} ↗</a></p></div>
        </div>
      </div>
      <div class="actions no-print">
        <button class="btn primary" id="share">🔗 ${esc(t("share"))}</button>
        <button class="btn ghost" onclick="print()">🖨️ ${esc(t("print"))}</button>
        <a class="btn ghost" href="#/plan" id="again">${esc(t("newPlan"))}</a>
      </div>
      <div class="card no-print" style="background:var(--sky-soft);border-color:#bfe6f4">
        <h2>🏘️ ${esc(t("nextStep"))}</h2><p>${esc(t("nextStepD"))}</p>
        <a class="btn primary" href="#/group/new">${esc(t("ctaGroup"))} →</a>
      </div>
    </div>`);
    const upd = () => {
      const n = Object.values(checked).filter(Boolean).length;
      document.getElementById("bagbar").style.width = (bag.length ? (n / bag.length) * 100 : 0) + "%";
      document.getElementById("bagcount").textContent = `${n} / ${bag.length} ${t("packed")}`;
    };
    upd();
    $app.querySelectorAll(".bag input").forEach((c) => c.onchange = () => { checked[c.dataset.i] = c.checked; store.set("bag:" + id, checked); upd(); });
    document.getElementById("again").onclick = () => { step = 0; };
    document.getElementById("share").onclick = async () => {
      const url = origin + "#/plan/" + id;
      if (navigator.share) { try { await navigator.share({ title: "BanjirSiap", text: p.headline, url }); return; } catch {} }
      copy(url);
    };
  }

  // ------------------------------------------------------------- groups
  function newGroup() {
    h(`<div class="wiz"><div class="card">
      <h2>🏘️ ${esc(t("gNewTitle"))}</h2><p class="muted">${esc(t("gNewSub"))}</p>
      <form id="gf">
        <label class="f" for="gn">${esc(t("gName"))}</label><input id="gn" type="text" required maxlength="80" placeholder="${esc(t("gNamePh"))}">
        <label class="f" for="ga">${esc(t("gArea"))}</label><input id="ga" type="text" maxlength="80" placeholder="${esc(t("gAreaPh"))}">
        <label class="f" for="gc">${esc(t("gCoord"))}</label><input id="gc" type="text" maxlength="60">
        <div style="margin-top:18px"><button class="btn primary block" type="submit">${esc(t("create"))}</button></div>
      </form></div></div>`);
    document.getElementById("gf").onsubmit = async (e) => {
      e.preventDefault(); const b = e.target.querySelector("button"); b.disabled = true; b.textContent = t("loading");
      try {
        const g = await api("/groups", { body: { lang, name: gn.value, area: ga.value, coordinator: gc.value } });
        store.set("admin:" + g.id, g.adminKey);
        location.hash = `#/created/${g.id}/${g.adminKey}`;
      } catch { b.disabled = false; b.textContent = t("create"); toast(t("err")); }
    };
  }
  function loadQR() {
    return new Promise((res) => {
      if (window.QRCode) return res();
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = res; s.onerror = res; document.head.appendChild(s);
    });
  }
  async function created(id, key) {
    let g; try { g = await api("/groups/" + id); } catch { return h(errorView("#/group/new")); }
    const res = origin + "#/g/" + id, adm = origin + `#/board/${id}/${key}`;
    const invite = t("waInvite").replace("{name}", g.name) + "\n" + res;
    h(`<div class="wiz stack">
      <div class="card"><h2>✅ ${esc(t("gReady"))}</h2><p><b>${esc(g.name)}</b>${g.area ? " · " + esc(g.area) : ""}</p></div>
      <div class="card"><h3>${esc(t("residentLink"))}</h3><p class="muted small">${esc(t("residentLinkD"))}</p>
        <div class="linkbox"><input type="text" readonly value="${esc(res)}"><button class="btn ghost" data-copy="${esc(res)}">${esc(t("copy"))}</button></div>
        <div class="row" style="margin-top:12px"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(invite))}">💬 ${esc(t("shareWa"))}</a></div>
        <div style="margin-top:14px" class="qr" id="qr"></div></div>
      <div class="card" style="border-color:#f2b8be"><h3>🔒 ${esc(t("adminLink"))}</h3><p class="muted small">${esc(t("adminLinkD"))}</p>
        <div class="linkbox"><input type="text" readonly value="${esc(adm)}"><button class="btn ghost" data-copy="${esc(adm)}">${esc(t("copy"))}</button></div>
        <a class="btn primary block" style="margin-top:12px" href="#/board/${esc(id)}/${esc(key)}">${esc(t("openBoard"))} →</a></div>
    </div>`);
    $app.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copy(b.dataset.copy));
    await loadQR();
    if (window.QRCode) new QRCode(document.getElementById("qr"), { text: res, width: 168, height: 168, colorDark: "#0b4f6c" });
  }

  const waterIcon = (lvl) => {
    const y = { none: 70, ankle: 62, knee: 48, waist: 36, chest: 24 }[lvl];
    return `<svg viewBox="0 0 34 70" aria-hidden="true"><circle cx="17" cy="9" r="6" fill="#3d5562"/><rect x="11" y="16" width="12" height="26" rx="5" fill="#3d5562"/><rect x="11" y="40" width="5" height="28" rx="2" fill="#3d5562"/><rect x="18" y="40" width="5" height="28" rx="2" fill="#3d5562"/>${lvl !== "none" ? `<rect x="0" y="${y}" width="34" height="${70 - y}" fill="#47c1e8" opacity=".75"/>` : ""}</svg>`;
  };
  async function checkinView(id) {
    let g; h(loadingView());
    try { g = await api("/groups/" + id); } catch { return h(errorView("#/")); }
    const me = store.get("me:" + id, { name: "", unit: "", people: 1, phone: "", status: "", needs: [], water: "none", note: "" });
    const draw = () => {
      h(`<div class="wiz stack">
        <div class="card"><p class="muted">${esc(t("ciTitle"))}</p><h2>${esc(g.name)}</h2><p class="muted small" style="margin:0">${esc(g.area || "")} · ${esc(t("safe"))} ${g.counts.safe} · ${esc(t("needHelp"))} ${g.counts.help} · ${esc(t("evacuated"))} ${g.counts.evacuated}</p></div>
        ${me.memberId ? `<div class="demo-banner">✓ ${esc(t("sent"))}</div>` : ""}
        <form class="card" id="cf">
          <p class="muted">${esc(t("ciSub"))}</p>
          <div class="status-btns">
            <button type="button" class="sbtn safe" data-s="safe" aria-pressed="${me.status === "safe"}"><span class="e">✅</span>${esc(t("s_safe"))}</button>
            <button type="button" class="sbtn help" data-s="help" aria-pressed="${me.status === "help"}"><span class="e">🆘</span>${esc(t("s_help"))}</button>
            <button type="button" class="sbtn evacuated" data-s="evacuated" aria-pressed="${me.status === "evacuated"}"><span class="e">🚐</span>${esc(t("s_evacuated"))}</button>
          </div>
          ${me.status === "help" ? `<p class="tip" style="margin-top:14px">☎️ ${esc(t("helpTip"))} <a href="tel:999">999</a></p>` : ""}
          <label class="f" for="cn">${esc(t("yourName"))}</label><input id="cn" type="text" required maxlength="60" value="${esc(me.name)}">
          <label class="f" for="cu">${esc(t("unit"))}</label><input id="cu" type="text" maxlength="60" value="${esc(me.unit)}">
          <label class="f">${esc(t("water"))}</label>
          <div class="water">${["none", "ankle", "knee", "waist", "chest"].map((w) => `<button type="button" class="wbtn" data-w="${w}" aria-pressed="${me.water === w}">${waterIcon(w)}${esc(t("w_" + w))}</button>`).join("")}</div>
          ${me.status === "help" ? `<label class="f">${esc(t("needs"))}</label><div class="chips">${["elderly", "mobility", "medical", "infant", "child", "pregnant", "pet"].map((n) => `<button type="button" class="chip" data-n="${n}" aria-pressed="${me.needs.includes(n)}">${esc(t("n_" + n))}</button>`).join("")}</div>` : ""}
          <div class="counter"><span>${esc(t("people"))}</span><div class="ctl"><button type="button" data-p="-1">−</button><output id="pp">${me.people}</output><button type="button" data-p="1">+</button></div></div>
          <label class="f" for="cp">${esc(t("phone"))}</label><input id="cp" type="tel" maxlength="20" value="${esc(me.phone)}">
          <label class="f" for="cnote">${esc(t("note"))}</label><textarea id="cnote" maxlength="280">${esc(me.note)}</textarea>
          <div style="margin-top:16px"><button class="btn primary block" type="submit" ${me.status ? "" : "disabled"}>${esc(me.memberId ? t("update") : t("send"))}</button></div>
        </form>
        <a class="btn ghost" href="#/photo">📸 ${esc(t("ctaPhoto"))}</a>
      </div>`);
      const keep = () => { me.name = cn.value; me.unit = cu.value; me.phone = cp.value; me.note = cnote.value; };
      $app.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { keep(); me.status = b.dataset.s; if (me.status !== "help") me.needs = []; draw(); });
      $app.querySelectorAll("[data-w]").forEach((b) => b.onclick = () => { keep(); me.water = b.dataset.w; draw(); });
      $app.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => { const n = b.dataset.n; me.needs = me.needs.includes(n) ? me.needs.filter((x) => x !== n) : [...me.needs, n]; b.setAttribute("aria-pressed", me.needs.includes(n)); });
      $app.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { me.people = Math.max(1, Math.min(30, me.people + +b.dataset.p)); pp.textContent = me.people; });
      document.getElementById("cf").onsubmit = async (e) => {
        e.preventDefault(); keep(); const btn = e.target.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = t("loading");
        try {
          const r = await api(`/groups/${id}/checkins`, { body: { ...me } });
          me.memberId = r.memberId; store.set("me:" + id, me); toast(t("sent"));
          g = await api("/groups/" + id); draw();
        } catch { btn.disabled = false; toast(t("err")); }
      };
    };
    draw();
  }

  // ------------------------------------------------------------- coordinator board
  async function board(id, key) {
    store.set("admin:" + id, key);
    let g, triageBusy = false;
    const ago = (ts) => { const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60)); return m < 60 ? `${m} ${t("min")} ${t("ago")}` : `${Math.round(m / 60)}h ${t("ago")}`; };
    const draw = () => {
      const tri = g.triage; const act = {}; (tri?.actions || []).forEach((a) => act[a.id] = a);
      const res = origin + "#/g/" + id;
      h(`<div class="stack">
        ${g.demo ? `<div class="demo-banner">🎬 Demo group with sample residents. Try “${esc(t("runTriage"))}”, or open the <a href="#/g/${esc(id)}">resident link</a> in another tab and check in yourself.</div>` : ""}
        <div class="card"><div class="row"><div><p class="muted" style="margin:0">${esc(t("boardTitle"))}</p><h2 style="margin:0">${esc(g.name)}</h2><p class="muted small" style="margin:0">${esc(g.area || "")}</p></div><span class="spacer"></span><span class="live">${esc(t("autoRefresh"))}</span></div></div>
        <div class="tiles">
          <div class="tile help"><b>${g.counts.help}</b><span>${esc(t("needHelp"))}</span></div>
          <div class="tile safe"><b>${g.counts.safe}</b><span>${esc(t("safe"))}</span></div>
          <div class="tile evacuated"><b>${g.counts.evacuated}</b><span>${esc(t("evacuated"))}</span></div>
          <div class="tile people"><b>${g.counts.people}</b><span>${esc(t("totalPeople"))}</span></div>
        </div>
        <div class="card">
          <button class="btn primary block" id="tri" ${triageBusy ? "disabled" : ""}>🧠 ${esc(triageBusy ? t("triageRunning") : t("runTriage"))}</button>
          <p class="muted small" style="margin:8px 0 0">${esc(t("triageNote"))}</p>
        </div>
        ${tri ? `<div class="grid2">
          <div class="card sitrep"><h3>📋 ${esc(t("sitrep"))}</h3><p>${esc(tri.sitrep)}</p>
            <h3>📦 ${esc(t("supplies"))}</h3><ul>${(tri.supplies || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
          <div class="card"><h3>📣 ${esc(t("broadcast"))}</h3><div class="wa-msg">${esc(tri.broadcast)}</div>
            <div class="row" style="margin-top:10px"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(tri.broadcast || ""))}">💬 ${esc(t("sendWa"))}</a><button class="btn ghost" data-copy="${esc(tri.broadcast)}">${esc(t("copy"))}</button></div></div>
        </div>` : ""}
        <div class="card">
          ${g.members.length ? g.members.map((m) => {
            const a = act[m.id];
            return `<div class="member ${esc(m.status)}"><div class="bar"></div><div>
              <div class="top-row"><span class="name">${m.status === "help" ? "🆘" : m.status === "safe" ? "✅" : "🚐"} ${esc(m.name)}</span>
                ${m.status === "help" ? `<span class="prio">${esc(t("priority"))} ${m.priority}</span>` : `<span class="muted small">${esc(t(m.status === "safe" ? "safe" : "evacuated"))}</span>`}</div>
              <div class="muted small">${esc(m.unit || "")} · 👥 ${m.people} · ${esc(ago(m.updated))}${m.phone ? ` · <a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : ""}</div>
              <div class="tags">${m.water && m.water !== "none" ? `<span class="tag-s water">💧 ${esc(t("w_" + m.water))}</span>` : ""}${(m.needs || []).map((n) => `<span class="tag-s">${esc(t("n_" + n))}</span>`).join("")}</div>
              ${m.note ? `<div class="small">“${esc(m.note)}”</div>` : ""}
              ${a ? `<div class="ai-action ${a.escalate ? "esc" : ""}">${a.escalate ? `<span class="esc-badge">${esc(t("escalate"))}</span>` : "🧠 "}${esc(a.action)}</div>` : ""}
            </div></div>`;
          }).join("") : `<p class="muted">${esc(t("noMembers"))}</p>`}
        </div>
        <div class="card"><h3>${esc(t("invite"))}</h3>
          <div class="linkbox"><input type="text" readonly value="${esc(res)}"><button class="btn ghost" data-copy="${esc(res)}">${esc(t("copy"))}</button></div>
          <div class="row" style="margin-top:10px"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(t("waInvite").replace("{name}", g.name) + "\n" + res))}">💬 ${esc(t("shareWa"))}</a><a class="btn ghost" href="#/g/${esc(id)}">${esc(t("ciTitle"))} →</a></div>
        </div>
      </div>`);
      $app.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copy(b.dataset.copy));
      document.getElementById("tri").onclick = async () => {
        triageBusy = true; draw();
        try { await api(`/groups/${id}/triage`, { body: { key, lang } }); g = await api(`/groups/${id}?key=${encodeURIComponent(key)}`); }
        catch { toast(t("err")); }
        triageBusy = false; draw();
      };
    };
    h(loadingView());
    try { g = await api(`/groups/${id}?key=${encodeURIComponent(key)}`); if (!g.admin) throw 0; } catch { return h(errorView("#/")); }
    draw();
    timers.push(setInterval(async () => {
      if (triageBusy || document.hidden) return;
      try { const n = await api(`/groups/${id}?key=${encodeURIComponent(key)}`); const changed = JSON.stringify(n) !== JSON.stringify(g); g = n; if (changed) { const y = scrollY; draw(); scrollTo(0, y); } } catch {}
    }, 20000));
  }

  // ------------------------------------------------------------- photo
  // ---- on-device computer vision (MediaPipe Tasks Vision, WASM) ----
  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
  const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
  let faceDet = null;
  async function getFaceDetector() {
    if (faceDet !== null) return faceDet;
    try {
      const mp = await import(MP + "/vision_bundle.mjs");
      const files = await mp.FilesetResolver.forVisionTasks(MP + "/wasm");
      faceDet = await mp.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" }, runningMode: "IMAGE", minDetectionConfidence: 0.35 });
    } catch (e) { console.warn("MediaPipe unavailable", e); faceDet = false; }
    return faceDet;
  }
  function loadCanvas(file, max = 1024) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c);
      };
      img.onerror = rej; img.src = url;
    });
  }
  function pixelate(c, x, y, w, h) {
    const ctx = c.getContext("2d");
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(c.width - x, Math.ceil(w)); h = Math.min(c.height - y, Math.ceil(h));
    if (w < 2 || h < 2) return;
    const tiny = document.createElement("canvas"); const cells = 7; tiny.width = cells; tiny.height = Math.max(2, Math.round(cells * h / w));
    tiny.getContext("2d").drawImage(c, x, y, w, h, 0, 0, tiny.width, tiny.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h); ctx.imageSmoothingEnabled = true;
  }
  async function blurFaces(c) {
    const det = await getFaceDetector();
    if (!det) return { faces: 0, ok: false };
    let n = 0;
    try {
      for (const d of det.detect(c).detections || []) {
        const b = d.boundingBox; const px = b.width * 0.35, py = b.height * 0.5;
        pixelate(c, b.originX - px, b.originY - py, b.width + 2 * px, b.height + 2 * py); n++;
      }
    } catch (e) { console.warn(e); return { faces: 0, ok: false }; }
    return { faces: n, ok: true };
  }
  function drawOverlay(canvas, src, objects) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
      const lw = Math.max(2, img.width / 300), fs = Math.max(12, img.width / 45);
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      for (const o of objects || []) {
        const [l, tp, w, hh] = o.box; const x = l * img.width, y = tp * img.height, W = w * img.width, H = hh * img.height;
        const col = o.label === "Person" ? "#f2c230" : "#47c1e8";
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(x, y, W, H);
        const txt = `${o.label} ${o.conf}%`; const tw = ctx.measureText(txt).width + 8;
        ctx.fillStyle = col; ctx.fillRect(x, Math.max(0, y - fs - 6), tw, fs + 6);
        ctx.fillStyle = "#0f2430"; ctx.fillText(txt, x + 4, Math.max(fs, y - 5));
      }
    };
    img.src = src;
  }
  // Live in-page camera (getUserMedia). Works even where <input capture> is ignored (iOS in-app browsers).
  async function openCamera(onShot, fallback) {
    if (!navigator.mediaDevices?.getUserMedia) return fallback();
    let facing = "environment", stream = null;
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:60;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px";
    ov.innerHTML = `<video playsinline autoplay muted style="max-width:100%;max-height:70vh;border-radius:12px;background:#111"></video>
      <div class="row" style="justify-content:center"><button class="btn glass" data-a="flip">🔄</button><button class="btn light" data-a="shot" style="min-width:140px">📸 ${esc(t("takePhoto"))}</button><button class="btn glass" data-a="close">✕</button></div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector("video");
    const stop = () => { stream && stream.getTracks().forEach((tr) => tr.stop()); };
    const start = async () => {
      stop();
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false }); video.srcObject = stream; await video.play().catch(() => {}); }
      catch (e) { console.warn(e); stop(); ov.remove(); fallback(); }
    };
    ov.onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
      if (a === "close") { stop(); ov.remove(); }
      if (a === "flip") { facing = facing === "environment" ? "user" : "environment"; start(); }
      if (a === "shot" && video.videoWidth) {
        const s = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
        const c = document.createElement("canvas"); c.width = Math.round(video.videoWidth * s); c.height = Math.round(video.videoHeight * s);
        c.getContext("2d").drawImage(video, 0, 0, c.width, c.height); stop(); ov.remove(); onShot(c);
      }
    };
    start();
  }
  function photo() {
    let dataUrl = null, privacy = null;
    getFaceDetector(); // warm up the on-device model while the user picks a photo
    const draw = (result, busy, scanning) => {
      const v = result?.verdict; const vis = result?.vision;
      const vd = (k, e, label) => `<div class="vd ${esc(v[k])}"><div class="e">${e}</div><b>${esc(t(v[k]))}</b><span class="small">${esc(label)}</span></div>`;
      const depthY = (cm) => 140 - Math.min(cm, 140);
      const counts = {}; (vis?.objects || []).forEach((o) => counts[o.label] = (counts[o.label] || 0) + 1);
      h(`<div class="wiz stack" style="max-width:720px">
        <div class="card"><h2>📸 ${esc(t("phTitle"))}</h2><p class="muted">${esc(t("phSub"))}</p>
          <div class="drop">${result && vis && vis.objects.length ? `<canvas id="ov" style="max-width:100%;max-height:420px;border-radius:12px;display:block;margin:0 auto 12px"></canvas>` : dataUrl ? `<img src="${dataUrl}" alt="">` : `<div style="font-size:3rem">🌊</div>`}
            ${scanning ? `<p class="muted small">${esc(t("scanning"))}</p>` : ""}
            ${privacy && privacy.ok ? `<p class="small" style="margin:0 0 10px"><span class="pill">MediaPipe</span> 🔒 ${privacy.faces} ${esc(t("facesBlurred"))}</p>` : ""}
            <div class="row" style="justify-content:center"><label class="btn ghost" for="pf">🖼️ ${esc(t("choose"))}</label><button type="button" class="btn ghost" id="cam">📷 ${esc(t("takePhoto"))}</button></div>
            <input id="pf" type="file" accept="image/*" hidden><input id="pc" type="file" accept="image/*" capture="environment" hidden>
          </div>
          <button class="btn primary block" id="go" style="margin-top:12px" ${dataUrl && !busy && !scanning ? "" : "disabled"}>${busy ? esc(t("loading")) : "🔍 " + esc(t("analyze"))}</button>
          <p class="muted small" style="margin:10px 0 0">🔒 ${esc(t("photoPrivacy"))}</p>
        </div>
        ${result && !result.isFloodScene ? `<div class="card"><p>${esc(t("notFlood"))}</p></div>` : ""}
        ${result && result.isFloodScene ? `
        <div class="card"><div class="gauge">
          <svg viewBox="0 0 90 150" aria-hidden="true"><rect x="0" y="0" width="90" height="140" rx="8" fill="#eef2f4"/>
            <circle cx="45" cy="18" r="9" fill="#3d5562"/><rect x="36" y="29" width="18" height="50" rx="7" fill="#3d5562"/><rect x="36" y="76" width="7" height="62" rx="3" fill="#3d5562"/><rect x="47" y="76" width="7" height="62" rx="3" fill="#3d5562"/>
            <rect x="0" y="${depthY(result.depthCm)}" width="90" height="${140 - depthY(result.depthCm)}" fill="#1479a3" opacity=".6"/>
            <text x="45" y="149" font-size="9" text-anchor="middle" fill="#6b818d">~${+result.depthCm} cm</text></svg>
          <div><p class="muted" style="margin:0">${esc(t("depth"))}</p><h2 style="margin:0">${esc(t("w_" + result.depth))} · ~${+result.depthCm} cm</h2>
            <p style="margin:6px 0">${esc(t("flow"))}: <b>${esc(t("fl_" + (result.flowing || "unknown")))}</b></p>
            ${result.referenceObject ? `<p class="small" style="margin:0 0 6px">📏 ${esc(t("measured"))}: <b>${esc(result.referenceObject)}</b>${result.submergedFraction != null ? ` · ~${Math.round(+result.submergedFraction * 100)}% ${esc(t("underwater"))}` : ""}</p>` : ""}
            <p class="small" style="margin:0">${esc(result.summary || "")}</p></div></div></div>
        <div class="verdicts">${vd("walk", "🚶", t("vWalk"))}${vd("car", "🚗", t("vCar"))}${vd("motorcycle", "🛵", t("vMoto"))}${vd("home", "🏠", t("vHome"))}</div>
        <div class="card">
          ${(result.hazards || []).length ? `<h3>⚠️ ${esc(t("hazards"))}</h3><ul>${result.hazards.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
          <p class="small" style="margin-top:10px"><b>${esc(t("basedOn"))}:</b> ${esc(result.references || "")}</p>
          <p class="tip">${esc(t("rule"))}</p>
        </div>` : ""}
        ${result && vis ? `<div class="card"><h3>🧠 ${esc(t("aiHow"))}</h3>
          <ol class="small" style="padding-left:20px;margin:0 0 10px">
            <li>${esc(t("pipe1"))}${privacy && privacy.ok ? ` (${privacy.faces})` : ""}</li><li>${esc(t("pipe2"))}</li><li>${esc(t("pipe3"))}</li><li>${esc(t("pipe4"))}</li></ol>
          ${vis.detector ? `<p class="small" style="margin:0 0 6px"><b>${esc(t("detFound"))}:</b> ${Object.entries(counts).map(([k, n]) => `${esc(k)} ×${n}`).join(" · ") || "–"}</p>
          <p class="small" style="margin:0 0 6px"><b>${esc(t("floodEv"))}:</b> Flood ${vis.floodConfidence}% · Water ${vis.waterConfidence}%</p>
          <p class="small" style="margin:0"><span class="badge ${vis.agree ? "low" : "moderate"}">${vis.agree ? "✓ " + esc(t("agreeYes")) : "⚠ " + esc(t("agreeNo"))}</span></p>` : ""}
        </div>` : ""}
      </div>`);
      if (result && vis && vis.objects.length) drawOverlay(document.getElementById("ov"), dataUrl, vis.objects);
      const useCanvas = async (c) => {
        dataUrl = c.toDataURL("image/jpeg", 0.85); privacy = null; draw(null, false, true);
        privacy = await blurFaces(c); dataUrl = c.toDataURL("image/jpeg", 0.85); draw(null, false, false);
      };
      const onPick = async (e) => { const f = e.target.files[0]; if (!f) return; useCanvas(await loadCanvas(f)); };
      document.getElementById("pf").onchange = onPick; document.getElementById("pc").onchange = onPick;
      document.getElementById("cam").onclick = () => openCamera(useCanvas, () => document.getElementById("pc").click());
      document.getElementById("go").onclick = async () => {
        draw(null, true);
        try { const r = await api("/photo", { body: { lang, image: dataUrl } }); draw(r, false); }
        catch { toast(t("err")); draw(null, false); }
      };
    };
    draw(null, false);
  }

  // ------------------------------------------------------------- about
  function about() {
    h(`<div class="stack">
      <div class="card"><h1 style="font-size:1.8rem">${esc(t("howTitle"))}</h1>
      <svg class="arch" viewBox="0 0 860 305" role="img" aria-label="Architecture: browser to CloudFront, S3 static site, API Gateway, Lambda, DynamoDB, Amazon Bedrock">
        <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6b818d"/></marker></defs>
        <style>.b{fill:#fff;stroke:#dbe5ea;stroke-width:2;rx:12}.t{font:600 14px system-ui;fill:#0f2430}.s{font:12px system-ui;fill:#6b818d}.l{stroke:#6b818d;stroke-width:2;fill:none;marker-end:url(#ar)}</style>
        <rect class="b" x="10" y="115" width="120" height="70" rx="12"/><text class="t" x="70" y="145" text-anchor="middle">📱 Residents</text><text class="s" x="70" y="165" text-anchor="middle">MediaPipe on-device</text>
        <rect class="b" x="175" y="115" width="140" height="70" rx="12"/><text class="t" x="245" y="145" text-anchor="middle">CloudFront</text><text class="s" x="245" y="165" text-anchor="middle">CDN + HTTPS</text>
        <rect class="b" x="370" y="25" width="140" height="70" rx="12"/><text class="t" x="440" y="55" text-anchor="middle">Amazon S3</text><text class="s" x="440" y="75" text-anchor="middle">static web app</text>
        <rect class="b" x="370" y="200" width="140" height="70" rx="12"/><text class="t" x="440" y="230" text-anchor="middle">API Gateway</text><text class="s" x="440" y="250" text-anchor="middle">HTTP API, throttled</text>
        <rect class="b" x="560" y="200" width="130" height="70" rx="12"/><text class="t" x="625" y="230" text-anchor="middle">AWS Lambda</text><text class="s" x="625" y="250" text-anchor="middle">Python · rules engine</text>
        <rect class="b" x="730" y="120" width="120" height="70" rx="12"/><text class="t" x="790" y="150" text-anchor="middle">Bedrock</text><text class="s" x="790" y="170" text-anchor="middle">Nova · text+vision</text>
        <rect class="b" x="730" y="15" width="120" height="70" rx="12"/><text class="t" x="790" y="45" text-anchor="middle">Rekognition</text><text class="s" x="790" y="65" text-anchor="middle">object detection</text>
        <rect class="b" x="730" y="225" width="120" height="70" rx="12"/><text class="t" x="790" y="255" text-anchor="middle">DynamoDB</text><text class="s" x="790" y="275" text-anchor="middle">TTL auto-delete</text>
        <path class="l" d="M130 150H172"/><path class="l" d="M315 140L367 70"/><path class="l" d="M315 160L367 228"/><path class="l" d="M510 235H557"/><path class="l" d="M690 225L727 165"/><path class="l" d="M670 200L760 88"/><path class="l" d="M690 250H727"/>
      </svg></div>
      <div class="grid2">
        <div class="card"><h3>Responsible-AI design</h3><ul class="principles">
          <li><b>Rules decide, AI explains.</b> Flood-risk scores, triage order and walk/drive verdicts come from transparent, testable rules. Amazon Bedrock personalises the plan and writes messages.</li>
          <li><b>No hallucinated numbers.</b> Emergency numbers and links are hard-coded; prompts forbid invented phone numbers or PPS names.</li>
          <li><b>Three-stage vision.</b> MediaPipe blurs faces on your phone; Amazon Rekognition finds reference objects (cars, wheels, people); Amazon Nova measures the water against their known heights. If the two models disagree, the safer reading wins.</li><li><b>Conservative thresholds.</b> 15 cm moving water / 30 cm floats a car are applied in code, never by the model.</li>
          <li><b>Graceful fallback.</b> If AI is unavailable, households still get a standard checklist, and the board still sorts by priority.</li>
        </ul></div>
        <div class="card"><h3>Privacy & cost</h3><ul class="principles">
          <li>No sign-up. Groups are unlisted; only the coordinator's secret link shows names and addresses.</li>
          <li>Photos are analysed in memory and never stored. Check-ins auto-delete after 30 days (DynamoDB TTL).</li>
          <li>Fully serverless, so it scales to zero between monsoons and absorbs a flood-night spike. API throttling caps cost.</li>
          <li>Built end to end by an AI coding agent connected to AWS (Claude), from infrastructure-as-code to deployment.</li>
        </ul></div>
      </div>
    </div>`);
  }

  // ------------------------------------------------------------- router
  function route() {
    clearTimers();
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [a, b, c] = parts;
    if (!a) return home();
    if (a === "plan" && !b) { step = 0; return wizard(); }
    if (a === "plan" && b) return showPlan(b);
    if (a === "group" && b === "new") return newGroup();
    if (a === "created") return created(b, c);
    if (a === "g" && b) return checkinView(b);
    if (a === "board" && b && c) return board(b, c);
    if (a === "photo") return photo();
    if (a === "about") return about();
    home();
  }
  window.addEventListener("hashchange", route);
  renderChrome();
  route();
})();
