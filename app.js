// URL vašeho Google Apps Script Web App
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwEDpLlUikYhMCJlolZZOgwqI8Gb_gMOYLwE4FDUtgD7hMIcHFGywGMwVG4pNNLRLU5CA/exec";

// Účet pro QR platby SPAYD
const IBAN_CZ = "CZ1808000000000737021033"; // Číslo účtu: 737021033/0800

function createBeanSVG(isActive) {
  return `
    <svg viewBox="0 0 30 30" class="bean-svg ${isActive ? 'active' : 'inactive'}">
      <ellipse cx="15" cy="15" rx="10.5" ry="13.5" class="bean-body" transform="rotate(-20 15 15)" />
      <path d="M 12 5.5 C 13.5 11, 14 15, 17.5 24" 
            class="bean-crease" 
            fill="none" 
            stroke-width="2.6" 
            stroke-linecap="round" />
    </svg>
  `;
}

let state = {
  users: [],
  finance: { cenaKavy: 10 },
  kava: { id: 1, nazev: "Načítám kávu...", acidita: 3, intenzita: 3, prazeni: 3, aktivni: 1, info: "" },
  allCoffees: [],
  ratings: [],
  currentUser: null,
  clicksInSession: 0,
  todayDrank: 0,
  logs: []
};

let undoTimeout = null;

// Registrace Service Workeru
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW reg failed: ", err));
  });
}

// ==========================================
// 1. START A BLESKOVÉ NAČÍTÁNÍ
// ==========================================
function tryInstantAutoLogin() {
  const savedUser = localStorage.getItem("zus_saved_user");
  if (!savedUser) return;
  try {
    const parsed = JSON.parse(savedUser);
    if (parsed && parsed.name) {
      state.currentUser = parsed;
      showMainScreen(parsed);
    }
  } catch (e) {
    localStorage.removeItem("zus_saved_user");
  }
}

function restoreCachedCoffeeData() {
  try {
    const cachedKava = localStorage.getItem("zus_cached_kava");
    const cachedRatings = localStorage.getItem("zus_cached_ratings");

    if (cachedKava) {
      state.kava = JSON.parse(cachedKava);
      renderCoffeeBadge();
    }
    if (cachedRatings) {
      state.ratings = JSON.parse(cachedRatings);
    }
    initRating();
  } catch (e) {
    console.warn("Chyba čtení mezipaměti:", e);
  }
}

async function loadData() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getData`);
    const data = await res.json();

    state.users = data.users || [];
    state.finance = data.finance || { cenaKavy: 10 };
    if (data.kava) {
      state.kava = data.kava;
      localStorage.setItem("zus_cached_kava", JSON.stringify(data.kava));
    }
    state.allCoffees = data.allCoffees || [];
    state.ratings = data.ratings || [];
    state.logs = data.logs || [];
    localStorage.setItem("zus_cached_ratings", JSON.stringify(state.ratings));

    renderCoffeeBadge();
    renderFinance();
    initRating();

    const priceInput = document.getElementById("admin-coffee-price");
    if (priceInput && state.finance.cenaKavy) {
      priceInput.value = state.finance.cenaKavy;
    }

    const savedUser = localStorage.getItem("zus_saved_user");
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      const freshUser = state.users.find(u => String(u.id) === String(parsed.id));
      if (freshUser) {
        state.currentUser = freshUser;
        localStorage.setItem("zus_saved_user", JSON.stringify(freshUser));
        updateCupsView();
        initRating();
      }
    }

    // Přepočet denního odznáčku ze serverových logů
    if (state.currentUser && state.logs && state.logs.length > 0) {
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);

      const serverToday = state.logs
        .filter(l => String(l.userId) === String(state.currentUser.id) && new Date(l.date) >= todayMidnight)
        .reduce((sum, l) => sum + Number(l.diff || 0), 0);

      state.todayDrank = Math.max(0, serverToday);
      saveDailyBadge();
      checkUndoAvailability();
    }

    const adminView = document.getElementById("admin-view");
    if (adminView && !adminView.classList.contains("hidden")) {
      renderAdminPendingRequests();
      renderAdminUsers();
      renderUsageStats();
      renderAdminCoffeeHistory();
    }
  } catch (err) {
    console.error("Chyba při synchronizaci:", err);
  }
}

// ==========================================
// 2. PŘIHLAŠOVÁNÍ A ODHLAŠOVÁNÍ
// ==========================================
function showMainScreen(user) {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("logout-btn").classList.remove("hidden");

  const adminBtn = document.getElementById("admin-switch-btn");
  const backBtn = document.getElementById("admin-back-btn");

  if (user.role === "admin") {
    if (adminBtn) adminBtn.classList.remove("hidden");
    if (backBtn) backBtn.classList.add("hidden");
  } else {
    if (adminBtn) adminBtn.classList.add("hidden");
    if (backBtn) backBtn.classList.add("hidden");
  }

  updateCupsView();
  initRating();
  syncDailyBadge();

  if (user.role === "admin" && localStorage.getItem("zus_current_view") === "admin") {
    openAdminScreen();
  }
}

// Chytřejší přihlašování s ověřením
document.getElementById("login-btn").addEventListener("click", async () => {
  const name = document.getElementById("login-name").value.trim();
  const pin = document.getElementById("login-pin").value.trim();
  const remember = document.getElementById("remember-me").checked;
  const loginBtn = document.getElementById("login-btn");

  if (!name || !pin) {
    alert("Vyplňte prosím jméno i PIN.");
    return;
  }

  let user = state.users.find(
    u => u.name.toLowerCase() === name.toLowerCase() && String(u.pin) === pin
  );

  // Pokud se nenašel, ověříme raději čerstvá data ze serveru (mohl být právě schválen/přidán)
  if (!user) {
    const originalText = loginBtn.textContent;
    loginBtn.textContent = "Ověřuji údaje na serveru...";
    loginBtn.disabled = true;

    try {
      await loadData();
      user = state.users.find(
        u => u.name.toLowerCase() === name.toLowerCase() && String(u.pin) === pin
      );
    } catch (e) {
      console.error("Chyba při ověřování:", e);
    } finally {
      loginBtn.textContent = originalText;
      loginBtn.disabled = false;
    }
  }

  if (user) {
    state.currentUser = user;
    state.clicksInSession = 0;
    if (remember) {
      localStorage.setItem("zus_saved_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("zus_saved_user");
    }
    showMainScreen(user);
  } else {
    alert("Nesprávné jméno nebo PIN.");
  }
});

// VSTUP HOSTA (ŽÁDOST O ÚČET BEZ PINU)
const guestToggleBtn = document.getElementById("guest-toggle-btn");
const guestBox = document.getElementById("guest-box");
const guestSubmitBtn = document.getElementById("guest-submit-btn");

if (guestToggleBtn) {
  guestToggleBtn.addEventListener("click", () => {
    guestBox.classList.toggle("hidden");
  });
}

if (guestSubmitBtn) {
  guestSubmitBtn.addEventListener("click", async () => {
    const name = document.getElementById("guest-name").value.trim();
    const phone = document.getElementById("guest-phone").value.trim();

    if (!name) { alert("Zadejte prosím své jméno."); return; }
    if (!phone || phone.length < 9) { alert("Zadejte prosím platné telefonní číslo."); return; }

    guestSubmitBtn.disabled = true;
    guestSubmitBtn.textContent = "Připravuji vstup...";

    try {
      const res = await fetch(SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ action: "requestAccount", name: name, phone: phone })
      });
      const data = await res.json();

      if (data.success && data.user) {
        state.currentUser = data.user;
        state.users.push(data.user);
        localStorage.setItem("zus_saved_user", JSON.stringify(data.user));
        alert(`Vítejte, ${name}! Váš kávový účet byl založen. Můžete si dát kávu. Správce vám brzy pošle PIN přes SMS.`);
        showMainScreen(data.user);
      } else {
        alert("Došlo k chybě při zakládání účtu.");
      }
    } catch (e) {
      alert("Chyba spojení se serverem.");
    } finally {
      guestSubmitBtn.disabled = false;
      guestSubmitBtn.textContent = "☕ Vstoupit a dát si kávu";
    }
  });
}

// Odhlášení
document.getElementById("logout-btn").addEventListener("click", () => {
  state.currentUser = null;
  state.clicksInSession = 0;
  state.todayDrank = 0;
  if (undoTimeout) clearTimeout(undoTimeout);
  
  localStorage.removeItem("zus_saved_user");
  localStorage.removeItem("zus_current_view");
  document.getElementById("login-name").value = "";
  document.getElementById("login-pin").value = "";
  document.getElementById("logout-btn").classList.add("hidden");
  
  const adminBtn = document.getElementById("admin-switch-btn");
  const backBtn = document.getElementById("admin-back-btn");
  if (adminBtn) adminBtn.classList.add("hidden");
  if (backBtn) backBtn.classList.add("hidden");

  document.getElementById("undo-btn").classList.add("hidden");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  
  renderDailyBadge(); 
});

// ==========================================
// 3. OTOČNÁ KARTA KÁVY A HODNOCENÍ
// ==========================================
const flipCard = document.getElementById("coffee-flip-card");
if (flipCard) {
  flipCard.addEventListener("click", () => {
    flipCard.classList.toggle("flipped");
  });
}

function renderBeansMeter(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    container.innerHTML += createBeanSVG(i <= value);
  }
}

function renderCoffeeBadge() {
  if (!state.kava) return;
  const nameEl = document.getElementById("coffee-name");
  const backNameEl = document.getElementById("coffee-back-name");
  const infoEl = document.getElementById("coffee-info-text");

  if (nameEl) nameEl.textContent = state.kava.nazev || "Výběrová káva";
  if (backNameEl) backNameEl.textContent = state.kava.nazev || "Výběrová káva";
  
  if (infoEl) {
    infoEl.textContent = state.kava.info && state.kava.info.trim() !== "" 
      ? state.kava.info 
      : "Zatím nebyly přidány žádné podrobnosti k této kávě.";
  }

  renderBeansMeter("beans-acidita", state.kava.acidita || 3);
  renderBeansMeter("beans-intenzita", state.kava.intenzita || 3);
  renderBeansMeter("beans-prazeni", state.kava.prazeni || 3);
}

function initRating() {
  const hearts = document.querySelectorAll("#hearts-container .heart-btn");
  let myRating = 0;

  if (state.currentUser && state.kava) {
    const directCache = localStorage.getItem(`zus_my_rating_${state.kava.id}_${state.currentUser.id}`);
    if (directCache !== null) {
      myRating = Number(directCache);
    } else {
      const found = state.ratings.find(
        r => String(r.kavaId) === String(state.kava.id) && String(r.userId) === String(state.currentUser.id)
      );
      if (found) {
        myRating = found.rating;
        localStorage.setItem(`zus_my_rating_${state.kava.id}_${state.currentUser.id}`, myRating);
      }
    }
  }

  paintHearts(myRating);

  hearts.forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation(); // Zabraní otočení karty, pokud by bylo srdíčko uvnitř karty
      const val = Number(btn.getAttribute("data-val"));
      if (!state.currentUser || !state.kava) return;

      paintHearts(val);
      localStorage.setItem(`zus_my_rating_${state.kava.id}_${state.currentUser.id}`, val);

      const existing = state.ratings.find(
        r => String(r.kavaId) === String(state.kava.id) && String(r.userId) === String(state.currentUser.id)
      );
      if (existing) {
        existing.rating = val;
      } else {
        state.ratings.push({ kavaId: state.kava.id, userId: state.currentUser.id, userName: state.currentUser.name, rating: val });
      }
      localStorage.setItem("zus_cached_ratings", JSON.stringify(state.ratings));

      try {
        await fetch(SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({ action: "saveRating", kavaId: state.kava.id, userId: state.currentUser.id, userName: state.currentUser.name, rating: val })
        });
      } catch (err) { console.error("Chyba při ukládání hodnocení:", err); }
    };
  });
}

function paintHearts(val) {
  const buttons = document.querySelectorAll("#hearts-container .heart-btn");
  buttons.forEach(btn => {
    if (Number(btn.getAttribute("data-val")) <= val) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

// ==========================================
// 4. DENNÍ ODZNÁČEK & ODKLIKÁVÁNÍ
// ==========================================
function syncDailyBadge() {
  if (!state.currentUser) return;
  const key = `zus_daily_badge_${state.currentUser.id}`;
  const todayStr = new Date().toDateString();
  const saved = localStorage.getItem(key);
  
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.date === todayStr) state.todayDrank = parsed.count;
    else { state.todayDrank = 0; localStorage.removeItem(key); }
  } else state.todayDrank = 0;
  
  renderDailyBadge();
  checkUndoAvailability();
}

function saveDailyBadge() {
  if (!state.currentUser) return;
  localStorage.setItem(`zus_daily_badge_${state.currentUser.id}`, JSON.stringify({ date: new Date().toDateString(), count: state.todayDrank }));
  renderDailyBadge();
}

function renderDailyBadge() {
  const badge = document.getElementById("main-cup-badge");
  if (!badge) return;
  if (state.todayDrank > 0) {
    badge.textContent = state.todayDrank;
    badge.classList.remove("hidden");
  } else badge.classList.add("hidden");
}

function checkUndoAvailability() {
  const undoBtn = document.getElementById("undo-btn");
  if (!undoBtn) return;
  if (state.todayDrank > 1 && state.clicksInSession > 0) undoBtn.classList.remove("hidden");
  else { undoBtn.classList.add("hidden"); if (undoTimeout) clearTimeout(undoTimeout); }
}

function triggerUndoTimer() {
  if (undoTimeout) clearTimeout(undoTimeout);
  checkUndoAvailability();
  undoTimeout = setTimeout(() => { state.clicksInSession = 0; checkUndoAvailability(); }, 120000);
}

const cupAction = document.getElementById("cup-action");
const undoBtn = document.getElementById("undo-btn");

if (cupAction) {
  cupAction.addEventListener("click", () => {
    const u = state.currentUser;
    if (!u) return;
    u.drank += 1;
    state.clicksInSession += 1;
    state.todayDrank += 1;
    u.totalDrank = (Number(u.totalDrank) || 0) + 1;
    state.logs.push({ date: new Date().toISOString(), userId: u.id, diff: 1 });

    saveDailyBadge(); 
    updateCupsView();
    triggerUndoTimer();
    syncDrankToServer(u.id, u.drank);
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", async () => {
    const u = state.currentUser;
    if (!u || state.todayDrank <= 1 || state.clicksInSession <= 0) return;
    u.drank -= 1;
    state.clicksInSession -= 1;
    state.todayDrank -= 1;
    u.totalDrank = Math.max(0, (Number(u.totalDrank) || 0) - 1);
    state.logs.push({ date: new Date().toISOString(), userId: u.id, diff: -1 });

    saveDailyBadge();
    updateCupsView();
    checkUndoAvailability();

    await syncDrankToServer(u.id, u.drank);
    await loadData();
  });
}

async function syncDrankToServer(userId, drank) {
  try {
    await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "drinkCoffee", id: userId, drank: drank }) });
  } catch (e) { console.error("Chyba:", e); }
}

// ==========================================
// 5. ŠÁLKY (DLUH) A FINANCE
// ==========================================
function updateCupsView() {
  const u = state.currentUser;
  if (!u) return;

  const totalCups = Number(u.prepaid) || 0;
  const drankCups = Number(u.drank) || 0;
  const cenaKavy = Number(state.finance.cenaKavy) || 10;
  
  const balance = totalCups - drankCups;
  const balanceMoney = balance * cenaKavy;

  const countText = document.getElementById("cups-count-text");
  const balanceText = document.getElementById("cups-balance-text");

  if (countText) countText.textContent = `${drankCups} / ${totalCups}`;
  if (balanceText) {
    if (balance < 0) {
      balanceText.textContent = `Dluh: ${Math.abs(balance)} ☕ (${Math.abs(balanceMoney)} Kč)`;
      balanceText.className = "text-danger";
    } else {
      balanceText.textContent = `Zbývá: ${balance} ☕ (${balanceMoney} Kč)`;
      balanceText.className = "text-success";
    }
  }

  const grid = document.getElementById("cups-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const miniCupSVG = `<svg viewBox="0 0 24 24"><path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/></svg>`;
  const gridCount = Math.max(totalCups, drankCups);

  for (let i = 1; i <= gridCount; i++) {
    const div = document.createElement("div");
    div.classList.add("mini-cup");
    div.innerHTML = miniCupSVG;
    if (i <= totalCups) div.classList.add(i <= drankCups ? "full" : "empty");
    else div.classList.add("debt");
    grid.appendChild(div);
  }

  const liquid = document.getElementById("liquid");
  if (liquid) liquid.style.opacity = drankCups >= totalCups && totalCups > 0 ? "0.15" : "1";
}

function renderFinance() {
  const vybrano = state.finance.vybrano || 0;
  const naklady = (state.finance.naklady || 0) + (state.finance.doprava || 0);
  const rozdil = vybrano - naklady;

  if (document.getElementById("fin-vybrano")) document.getElementById("fin-vybrano").textContent = `${vybrano} Kč`;
  if (document.getElementById("fin-naklady")) document.getElementById("fin-naklady").textContent = `${naklady} Kč`;
  if (document.getElementById("fin-rozdil")) document.getElementById("fin-rozdil").textContent = `${rozdil} Kč`;
}

// ==========================================
// 6. QR PLATBA SPAYD
// ==========================================
function generateSpaydString(amount, message) {
  const cleanMsg = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").substring(0, 60);
  const cleanAmount = Number(amount).toFixed(2);
  return `SPD*1.0*ACC:${IBAN_CZ}*AM:${cleanAmount}*CC:CZK*MSG:${cleanMsg}*`;
}

function updateQrPaymentModal() {
  if (!state.currentUser) return;
  const amount = Number(document.getElementById("qr-amount-input").value) || 150;
  const msg = `${state.currentUser.name} za kafe`;
  document.getElementById("qr-msg-text").textContent = msg;

  const spayd = generateSpaydString(amount, msg);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(spayd)}`;

  const img = document.getElementById("qr-pay-image");
  const spinner = document.getElementById("qr-loading-spinner");

  img.classList.add("hidden");
  spinner.classList.remove("hidden");
  img.onload = () => { spinner.classList.add("hidden"); img.classList.remove("hidden"); };
  img.src = qrUrl;
}

document.getElementById("open-qr-pay-btn")?.addEventListener("click", () => {
  document.getElementById("qr-pay-modal").classList.remove("hidden");
  updateQrPaymentModal();
});
document.getElementById("qr-close-btn")?.addEventListener("click", () => document.getElementById("qr-pay-modal").classList.add("hidden"));
document.getElementById("qr-amount-input")?.addEventListener("input", updateQrPaymentModal);
document.getElementById("qr-download-btn")?.addEventListener("click", async () => {
  const img = document.getElementById("qr-pay-image");
  if (!img.src) return;
  try {
    const resp = await fetch(img.src);
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `QR-platba-${state.currentUser ? state.currentUser.name : 'kafe'}.png`;
    a.click();
  } catch (e) { window.open(img.src, "_blank"); }
});

// ==========================================
// 7. ADMINISTRACE - PŘEPÍNÁNÍ
// ==========================================
document.getElementById("admin-switch-btn")?.addEventListener("click", openAdminScreen);
document.getElementById("admin-back-btn")?.addEventListener("click", closeAdminScreen);

function openAdminScreen() {
  localStorage.setItem("zus_current_view", "admin");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.remove("hidden");
  document.getElementById("admin-switch-btn")?.classList.add("hidden");
  document.getElementById("admin-back-btn")?.classList.remove("hidden");

  renderAdminPendingRequests();
  renderAdminCoffeeHistory();
  renderAdminUsers();
  renderUsageStats();
}
function closeAdminScreen() {
  localStorage.removeItem("zus_current_view");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  document.getElementById("admin-back-btn")?.classList.add("hidden");
  document.getElementById("admin-switch-btn")?.classList.remove("hidden");
}

// ==========================================
// 8. ADMINISTRACE - SCHVALOVÁNÍ HOSTŮ & SMS
// ==========================================
function renderAdminPendingRequests() {
  const container = document.getElementById("admin-pending-container");
  const list = document.getElementById("admin-pending-list");
  if (!container || !list) return;

  const pendingUsers = state.users.filter(u => u.pin === "PENDING" || !u.pin);
  if (pendingUsers.length === 0) { container.classList.add("hidden"); list.innerHTML = ""; return; }

  container.classList.remove("hidden");
  list.innerHTML = "";

  pendingUsers.forEach(pu => {
    const div = document.createElement("div");
    div.style = "background:#fff; border:1px solid var(--card-border); padding:8px 10px; border-radius:8px;";
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>${pu.name}</b><span style="font-size:0.85rem; color:var(--text-muted);">Tel: <a href="tel:${pu.phone}">${pu.phone}</a></span>
      </div>
      <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
        <input type="text" id="assign-pin-${pu.id}" placeholder="Zadej PIN" maxlength="4" style="width:75px; padding:4px; text-align:center;">
        <button class="btn btn-primary btn-small" onclick="adminSetPinAndSendSMS(${pu.id}, '${pu.phone}', '${pu.name}')">Uložit & Poslat SMS</button>
      </div>
    `;
    list.appendChild(div);
  });
}

window.adminSetPinAndSendSMS = async function(userId, phone, name) {
  const pin = document.getElementById(`assign-pin-${userId}`).value.trim();
  if (!pin || pin.length !== 4) { alert("Zadejte prosím 4místný číselný PIN."); return; }
  const user = state.users.find(u => String(u.id) === String(userId));
  if (user) user.pin = pin;

  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "adminSetPin", userId: userId, pin: pin }) });
  
  const cleanPhone = phone.replace(/\s+/g, "");
  const smsBody = encodeURIComponent(`Ahoj ${name}, tvuj PIN do ZUSkafe je: ${pin}. https://mkytaran.github.io/kavarna-zus/`);
  window.location.href = `sms:${cleanPhone}?body=${smsBody}`;
  
  await loadData();
};

// ==========================================
// 9. ADMINISTRACE - HISTORIE KÁV & TEXTY
// ==========================================
function renderAdminCoffeeHistory() {
  const container = document.getElementById("coffee-history-list");
  if (!container) return;
  container.innerHTML = "";

  state.allCoffees.forEach(coffee => {
    const coffeeRatings = state.ratings.filter(r => String(r.kavaId) === String(coffee.id) && r.rating > 0);
    let avg = "0.0";
    let roundAvg = 0;
    if (coffeeRatings.length > 0) {
      const sum = coffeeRatings.reduce((acc, r) => acc + r.rating, 0);
      avg = (sum / coffeeRatings.length).toFixed(1);
      roundAvg = Math.round(Number(avg));
    }

    const card = document.createElement("div");
    card.className = `coffee-card-item ${coffee.aktivni === 1 ? "is-active" : ""}`;
    let heartsStr = ""; for (let i = 1; i <= 5; i++) heartsStr += i <= roundAvg ? "♥" : "♡";

    let dateInfo = `<span style="font-size:0.75rem; color:#888;">Zatím nebyla nasazena</span>`;
    if (coffee.nasazenoOd) {
      const od = new Date(coffee.nasazenoOd);
      const doDatum = coffee.nasazenoDo ? new Date(coffee.nasazenoDo) : new Date();
      const dny = Math.max(1, Math.ceil((doDatum - od) / (1000 * 60 * 60 * 24)));
      dateInfo = `<span style="font-size:0.75rem; color:var(--text-muted);">🗓️ ${od.toLocaleDateString('cs-CZ')} – ${coffee.nasazenoDo ? new Date(coffee.nasazenoDo).toLocaleDateString('cs-CZ') : 'dosud'} <b>(${dny} dní)</b></span>`;
    }

    card.innerHTML = `
      <div class="coffee-card-head" onclick="toggleCoffeeDetail(${coffee.id})">
        <div>
          <div class="coffee-card-title">${coffee.nazev} ${coffee.aktivni === 1 ? '<span class="active-pill">V kávovaru</span>' : ''}</div>
          ${dateInfo}
          <div class="coffee-card-stats"><b>${avg}</b> <span class="hearts">${heartsStr}</span></div>
        </div>
        <span id="arrow-${coffee.id}" class="dropdown-arrow">▼</span>
      </div>
      <div id="detail-${coffee.id}" class="coffee-card-details hidden">
        <textarea id="edit-info-${coffee.id}" rows="2" style="width:100%; font-size:0.8rem; padding:4px;" placeholder="Doplňující informace...">${coffee.info || ""}</textarea>
        <button class="btn-small" style="margin-bottom:8px;" onclick="updateCoffeeInfo(${coffee.id})">Uložit text</button>
        <div id="votes-${coffee.id}">${coffeeRatings.length === 0 ? '<div style="font-size:0.8rem; font-style:italic; color:var(--text-muted);">Nikdo nehodnotil</div>' : ''}</div>
        <div class="card-actions">${coffee.aktivni !== 1 ? `<button class="btn btn-primary btn-small" onclick="setActiveCoffee(${coffee.id})">Nasadit do mlýnku</button>` : ''}</div>
      </div>
    `;
    container.appendChild(card);

    const votesContainer = card.querySelector(`#votes-${coffee.id}`);
    coffeeRatings.forEach(r => {
      votesContainer.innerHTML += `<div class="rating-user-row"><span>${r.userName}</span><span class="rating-user-hearts">${"♥".repeat(r.rating)}${"♡".repeat(5 - r.rating)}</span></div>`;
    });
  });
}

window.toggleCoffeeDetail = function(id) {
  document.getElementById(`detail-${id}`)?.classList.toggle("hidden");
  document.getElementById(`arrow-${id}`)?.classList.toggle("rotated");
};

window.setActiveCoffee = async function(id) {
  const chosen = state.allCoffees.find(c => String(c.id) === String(id));
  if (!chosen) return;

  state.allCoffees.forEach(c => c.aktivni = (String(c.id) === String(id) ? 1 : 0));
  state.kava = chosen;
  localStorage.setItem("zus_cached_kava", JSON.stringify(chosen));
  renderCoffeeBadge(); initRating(); renderAdminCoffeeHistory();

  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "setActiveCoffee", id: id }) });
  alert(`Káva "${chosen.nazev}" byla nastavena jako aktivní!`);
};

window.updateCoffeeInfo = async function(id) {
  const text = document.getElementById(`edit-info-${id}`).value;
  const c = state.allCoffees.find(x => String(x.id) === String(id));
  if (c) c.info = text;
  if (state.kava && String(state.kava.id) === String(id)) { state.kava.info = text; renderCoffeeBadge(); }
  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "updateCoffeeInfo", id: id, info: text }) });
  alert("Informace o kávě uloženy.");
};

async function handleCoffeeSave(deploy) {
  const nazev = document.getElementById("admin-coffee-name").value.trim();
  const info = document.getElementById("admin-coffee-info").value.trim();
  const acidita = Number(document.getElementById("admin-acidita").value);
  const intenzita = Number(document.getElementById("admin-intenzita").value);
  const prazeni = Number(document.getElementById("admin-prazeni").value);

  if (!nazev) { alert("Zadej prosím název nové kávy."); return; }

  const newId = state.allCoffees.length > 0 ? Math.max(...state.allCoffees.map(c => c.id)) + 1 : 1;
  const newCoffee = {
    id: newId, nazev: nazev, acidita: acidita, intenzita: intenzita, prazeni: prazeni, 
    aktivni: deploy ? 1 : 0, info: info, nasazenoOd: deploy ? new Date().toISOString() : null
  };

  if (deploy) {
    state.allCoffees.forEach(c => c.aktivni = 0);
    state.kava = newCoffee;
    localStorage.setItem("zus_cached_kava", JSON.stringify(newCoffee));
    renderCoffeeBadge(); initRating();
  }
  state.allCoffees.unshift(newCoffee);
  renderAdminCoffeeHistory();
  
  document.getElementById("admin-coffee-name").value = "";
  document.getElementById("admin-coffee-info").value = "";

  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "saveCoffee", deploy: deploy, nazev: nazev, info: info, acidita: acidita, intenzita: intenzita, prazeni: prazeni }) });
  alert(deploy ? `Káva nasazena!` : `Káva uložena do zásoby.`);
}

document.getElementById("admin-save-coffee-only")?.addEventListener("click", () => handleCoffeeSave(false));
document.getElementById("admin-save-coffee-deploy")?.addEventListener("click", () => handleCoffeeSave(true));

// ==========================================
// 10. ADMINISTRACE - CENA, UŽIVATELÉ, PLATBY
// ==========================================
document.getElementById("admin-save-price")?.addEventListener("click", async () => {
  const newPrice = Number(document.getElementById("admin-coffee-price").value);
  if (!newPrice || newPrice <= 0) { alert("Zadejte platnou cenu."); return; }
  state.finance.cenaKavy = newPrice;
  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "saveCoffeePrice", cena: newPrice }) });
  alert(`Cena uložena na ${newPrice} Kč.`);
});

function renderAdminUsers() {
  const tbody = document.getElementById("admin-user-list");
  const select = document.getElementById("payment-user");
  const leaderBoard = document.getElementById("admin-leaderboard-list");
  
  if (tbody) tbody.innerHTML = "";
  if (leaderBoard) leaderBoard.innerHTML = "";
  if (select) select.innerHTML = '<option value="">-- Vyber kafaře --</option><option value="NEW" style="font-weight: bold; color: var(--accent);">+ Přidat nového kafaře...</option>';

  const sortedUsers = [...state.users].sort((a, b) => b.totalDrank - a.totalDrank);
  
  sortedUsers.forEach(u => {
    if (leaderBoard) {
      leaderBoard.innerHTML += `<tr><td style="font-weight:700;">${u.name}</td><td style="font-weight:800; color:var(--primary); text-align:center;">${u.totalDrank}</td><td style="color:var(--text-muted); text-align:center;">${u.totalPaid} Kč</td></tr>`;
    }
  });

  state.users.forEach(u => {
    if (select) select.appendChild(new Option(u.name, u.id));
    if (tbody) {
      const balance = Number(u.prepaid) - Number(u.drank);
      const isDebt = balance < 0;
      tbody.innerHTML += `
        <tr>
          <td style="font-weight:700;">${u.name} <span style="font-size:0.7rem; color:var(--text-muted); font-weight:normal;">(${u.pin === 'PENDING' ? 'Čeká na PIN' : 'PIN: ' + u.pin})</span><br><span style="font-size:0.75rem; color:${isDebt ? 'var(--heart-active)' : 'var(--text-main)'}; font-weight:800;">Zůstatek: ${balance}</span></td>
          <td style="white-space:nowrap;"><input type="number" id="d-${u.id}" value="${u.drank}" style="width:36px; padding:2px;"> / <input type="number" id="p-${u.id}" value="${u.prepaid}" style="width:36px; padding:2px;"></td>
          <td><input type="number" id="tp-${u.id}" value="${u.totalPaid}" style="width:55px;"></td>
          <td style="text-align:center; font-weight:800; color:var(--primary);">${u.totalDrank}</td>
          <td><button class="btn btn-primary" style="padding:6px; font-size:0.75rem;" onclick="adminSaveUser(${u.id})">Uložit</button></td>
        </tr>`;
    }
  });
}

document.getElementById("payment-user")?.addEventListener("change", (e) => {
  const fields = document.getElementById("new-user-fields");
  if (e.target.value === "NEW") fields.classList.remove("hidden"); else fields.classList.add("hidden");
});

document.getElementById("admin-create-user-btn")?.addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim();
  const pin = document.getElementById("new-user-pin").value.trim();
  const phone = document.getElementById("new-user-phone").value.trim();
  if (!name || !pin || pin.length !== 4) { alert("Zadejte platné jméno a 4místný PIN."); return; }

  document.getElementById("new-user-name").value = ""; document.getElementById("new-user-pin").value = ""; document.getElementById("new-user-phone").value = "";
  document.getElementById("new-user-fields").classList.add("hidden");

  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "addUser", name: name, pin: pin, phone: phone }) });
  await loadData(); alert(`Přidán: ${name}`);
});

document.getElementById("admin-save-payment")?.addEventListener("click", async () => {
  const userId = document.getElementById("payment-user").value;
  const amount = document.getElementById("payment-amount").value;
  if (!userId || userId === "NEW" || !amount) { alert("Vyplň kafaře i částku."); return; }
  const u = state.users.find(x => String(x.id) === userId);
  if (!u) return;
  document.getElementById("payment-amount").value = "";

  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "addPayment", userId: userId, amount: amount }) });
  await loadData(); alert(`Připsáno ${amount} Kč uživateli ${u.name}.`);
});

window.adminSaveUser = async function(id) {
  const drk = Number(document.getElementById(`d-${id}`).value);
  const prep = Number(document.getElementById(`p-${id}`).value);
  const tPaid = Number(document.getElementById(`tp-${id}`).value);
  const u = state.users.find(x => String(x.id) === String(id));
  if (!u) return;

  if (state.currentUser && String(state.currentUser.id) === String(id)) {
    state.todayDrank = Math.max(0, state.todayDrank + (drk - Number(u.drank)));
    saveDailyBadge();
  }
  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk, totalPaid: tPaid }) });
  await loadData(); alert(`Uloženo: ${u.name}`);
};

// ==========================================
// 11. STATISTIKY (TÝDEN, MĚSÍC)
// ==========================================
function getWorkingDaysInMonth() {
  const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
  let count = 0; const date = new Date(year, month, 1);
  while (date.getMonth() === month) { if (date.getDay() !== 0 && date.getDay() !== 6) count++; date.setDate(date.getDate() + 1); }
  return count;
}

function renderUsageStats() {
  const weekly = document.getElementById("admin-weekly-list"); const monthly = document.getElementById("admin-monthly-list");
  if (!weekly || !monthly) return;
  weekly.innerHTML = ""; monthly.innerHTML = "";

  const now = new Date();
  const currentDay = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now); monday.setDate(now.getDate() - currentDay + 1); monday.setHours(0,0,0,0);
  const currentMonthStr = now.getFullYear() + "-" + now.getMonth();
  const workDays = getWorkingDaysInMonth();
  const wStats = {}; const mStats = {};
  
  state.users.forEach(u => { wStats[u.id] = [0,0,0,0,0]; mStats[u.id] = 0; });
  state.logs.forEach(l => {
    const d = new Date(l.date);
    if (d >= monday) { const idx = d.getDay() === 0 ? 6 : d.getDay() - 1; if (idx <= 4 && wStats[l.userId]) wStats[l.userId][idx] += l.diff; }
    if (d.getFullYear() + "-" + d.getMonth() === currentMonthStr && mStats[l.userId] !== undefined) mStats[l.userId] += l.diff;
  });

  const cupSVG = `<svg viewBox="0 0 24 24"><path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/></svg>`;
  state.users.forEach(u => {
    let cupsHtml = "";
    wStats[u.id].forEach(c => { cupsHtml += `<div class="day-cup-wrapper"><div class="day-cup ${c > 0 ? "drank" : ""}">${cupSVG}</div>${c > 1 ? `<div class="multi-cup-badge">${c}</div>` : ""}</div>`; });
    weekly.innerHTML += `<div class="stat-row"><div class="stat-name">${u.name}</div><div class="week-cups">${cupsHtml}</div></div>`;
    monthly.innerHTML += `<div class="stat-row"><div class="stat-name">${u.name}</div><div class="month-stat">${mStats[u.id]} / ${workDays}</div></div>`;
  });
}

document.querySelectorAll(".admin-details").forEach(detail => {
  detail.addEventListener("toggle", () => { if (detail.open) { renderUsageStats(); renderAdminUsers(); renderAdminPendingRequests(); } });
});

// ==========================================
// START APLIKACE
// ==========================================
tryInstantAutoLogin();
restoreCachedCoffeeData();
loadData();