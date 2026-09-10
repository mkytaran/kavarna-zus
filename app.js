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
  kava: { id: 1, nazev: "Brasil Pergamino Sul de Minas", acidita: 2, intenzita: 4, prazeni: 3, aktivni: 1 },
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

// 1. PŘIHLÁŠENÍ ZE ZÁLOHY (Okamžitý start i pro hosty)
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

// 2. OBNOVENÍ MEZIPAMĚTI
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

// 3. STAŽENÍ DAT ZE SERVERU
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

// PŘIHLAŠOVÁNÍ BĚŽNÉHO UŽIVATELE S PINEM
document.getElementById("login-btn").addEventListener("click", () => {
  const name = document.getElementById("login-name").value.trim();
  const pin = document.getElementById("login-pin").value.trim();
  const remember = document.getElementById("remember-me").checked;

  const user = state.users.find(
    u => u.name.toLowerCase() === name.toLowerCase() && String(u.pin) === pin
  );

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

// PŘIHLÁŠENÍ HOSTA (ŽÁDOST O ÚČET)
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

    if (!name) {
      alert("Zadejte prosím své jméno.");
      return;
    }
    if (!phone || phone.length < 9) {
      alert("Zadejte prosím platné telefonní číslo pro zaslání PINu.");
      return;
    }

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
      console.error(e);
      alert("Chyba spojení se serverem.");
    } finally {
      guestSubmitBtn.disabled = false;
      guestSubmitBtn.textContent = "☕ Vstoupit a dát si kávu";
    }
  });
}

// ODHLÁŠENÍ
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

// 4. KÁVOVÝ ŠTÍTEK
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
  if (nameEl) nameEl.textContent = state.kava.nazev || "Výběrová káva";
  renderBeansMeter("beans-acidita", state.kava.acidita || 3);
  renderBeansMeter("beans-intenzita", state.kava.intenzita || 3);
  renderBeansMeter("beans-prazeni", state.kava.prazeni || 3);
}

// 5. HODNOCENÍ SRDÍČKY
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
    btn.onclick = async () => {
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
        state.ratings.push({
          kavaId: state.kava.id,
          userId: state.currentUser.id,
          userName: state.currentUser.name,
          rating: val
        });
      }

      localStorage.setItem("zus_cached_ratings", JSON.stringify(state.ratings));

      try {
        await fetch(SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({
            action: "saveRating",
            kavaId: state.kava.id,
            userId: state.currentUser.id,
            userName: state.currentUser.name,
            rating: val
          })
        });
      } catch (err) {
        console.error("Chyba při ukládání hodnocení:", err);
      }
    };
  });
}

function paintHearts(val) {
  const buttons = document.querySelectorAll("#hearts-container .heart-btn");
  buttons.forEach(btn => {
    const btnVal = Number(btn.getAttribute("data-val"));
    if (btnVal <= val) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// 6. DENNÍ ODZNÁČEK
function syncDailyBadge() {
  if (!state.currentUser) return;
  const uId = state.currentUser.id;
  const key = `zus_daily_badge_${uId}`;
  const todayStr = new Date().toDateString();

  const saved = localStorage.getItem(key);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.date === todayStr) {
      state.todayDrank = parsed.count;
    } else {
      state.todayDrank = 0;
      localStorage.removeItem(key);
    }
  } else {
    state.todayDrank = 0;
  }
  renderDailyBadge();
  checkUndoAvailability();
}

function saveDailyBadge() {
  if (!state.currentUser) return;
  const uId = state.currentUser.id;
  const key = `zus_daily_badge_${uId}`;
  const todayStr = new Date().toDateString();
  localStorage.setItem(key, JSON.stringify({ date: todayStr, count: state.todayDrank }));
  renderDailyBadge();
}

function renderDailyBadge() {
  const badge = document.getElementById("main-cup-badge");
  if (!badge) return;
  if (state.todayDrank > 0) {
    badge.textContent = state.todayDrank;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// 7. KONTROLA A ČASOVAČ PRO VRÁCENÍ OMYLU
function checkUndoAvailability() {
  const undoBtn = document.getElementById("undo-btn");
  if (!undoBtn) return;

  if (state.todayDrank > 1 && state.clicksInSession > 0) {
    undoBtn.classList.remove("hidden");
  } else {
    undoBtn.classList.add("hidden");
    if (undoTimeout) clearTimeout(undoTimeout);
  }
}

function triggerUndoTimer() {
  if (undoTimeout) clearTimeout(undoTimeout);
  checkUndoAvailability();
  undoTimeout = setTimeout(() => {
    state.clicksInSession = 0;
    checkUndoAvailability();
  }, 120000);
}

// 8. ODKLIKÁVÁNÍ KÁVY
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

    state.logs.push({
      date: new Date().toISOString(),
      userId: u.id,
      diff: 1
    });

    saveDailyBadge(); 
    updateCupsView();
    triggerUndoTimer();
    syncDrankToServer(u.id, u.drank);
  });
}

// 9. VRÁCENÍ OMYLU
if (undoBtn) {
  undoBtn.addEventListener("click", async () => {
    const u = state.currentUser;
    if (!u || state.todayDrank <= 1 || state.clicksInSession <= 0) return;

    u.drank -= 1;
    state.clicksInSession -= 1;
    state.todayDrank -= 1;
    u.totalDrank = Math.max(0, (Number(u.totalDrank) || 0) - 1);

    state.logs.push({
      date: new Date().toISOString(),
      userId: u.id,
      diff: -1
    });

    saveDailyBadge();
    updateCupsView();
    checkUndoAvailability();

    await syncDrankToServer(u.id, u.drank);
    await loadData();
    renderUsageStats();
  });
}

async function syncDrankToServer(userId, drank) {
  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "drinkCoffee", id: userId, drank: drank })
    });
  } catch (e) {
    console.error("Chyba při ukládání kávy:", e);
  }
}

// 10. MŘÍŽKA ŠÁLKŮ & ZOBRAZENÍ DLUHU
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

  const miniCupSVG = `
    <svg viewBox="0 0 24 24">
      <path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/>
    </svg>
  `;

  const gridCount = Math.max(totalCups, drankCups);

  for (let i = 1; i <= gridCount; i++) {
    const div = document.createElement("div");
    div.classList.add("mini-cup");
    div.innerHTML = miniCupSVG;

    if (i <= totalCups) {
      if (i <= drankCups) {
        div.classList.add("full");
      } else {
        div.classList.add("empty");
      }
    } else {
      div.classList.add("debt");
    }
    
    grid.appendChild(div);
  }

  const liquid = document.getElementById("liquid");
  if (liquid) {
    liquid.style.opacity = drankCups >= totalCups && totalCups > 0 ? "0.15" : "1";
  }
}

// 11. POKLADNA
function renderFinance() {
  const vybrano = state.finance.vybrano || 0;
  const naklady = (state.finance.naklady || 0) + (state.finance.doprava || 0);
  const rozdil = vybrano - naklady;

  const elVyb = document.getElementById("fin-vybrano");
  const elNak = document.getElementById("fin-naklady");
  const elRoz = document.getElementById("fin-rozdil");

  if (elVyb) elVyb.textContent = `${vybrano} Kč`;
  if (elNak) elNak.textContent = `${naklady} Kč`;
  if (elRoz) elRoz.textContent = `${rozdil} Kč`;
}

// 12. GENERÁTOR ČESKÉ QR PLATBY (SPAYD)
function generateSpaydString(amount, message) {
  // Odstranění diakritiky pro stoprocentní kompatibilitu s bankovními aplikacemi
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

  img.onload = () => {
    spinner.classList.add("hidden");
    img.classList.remove("hidden");
  };
  img.src = qrUrl;
}

const openQrPayBtn = document.getElementById("open-qr-pay-btn");
const qrModal = document.getElementById("qr-pay-modal");
const qrCloseBtn = document.getElementById("qr-close-btn");
const qrAmountInput = document.getElementById("qr-amount-input");
const qrDownloadBtn = document.getElementById("qr-download-btn");

if (openQrPayBtn) {
  openQrPayBtn.addEventListener("click", () => {
    qrModal.classList.remove("hidden");
    updateQrPaymentModal();
  });
}

if (qrCloseBtn) {
  qrCloseBtn.addEventListener("click", () => {
    qrModal.classList.add("hidden");
  });
}

if (qrAmountInput) {
  qrAmountInput.addEventListener("input", () => {
    updateQrPaymentModal();
  });
}

if (qrDownloadBtn) {
  qrDownloadBtn.addEventListener("click", async () => {
    const img = document.getElementById("qr-pay-image");
    if (!img.src) return;
    try {
      const resp = await fetch(img.src);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `QR-platba-${state.currentUser ? state.currentUser.name : 'kafe'}.png`;
      a.click();
    } catch (e) {
      window.open(img.src, "_blank");
    }
  });
}

// 13. PŘEPÍNAČ ADMINISTRACE V HORNÍ LIŠTĚ
const adminSwitchBtn = document.getElementById("admin-switch-btn");
if (adminSwitchBtn) {
  adminSwitchBtn.addEventListener("click", () => {
    openAdminScreen();
  });
}

const adminBackBtn = document.getElementById("admin-back-btn");
if (adminBackBtn) {
  adminBackBtn.addEventListener("click", () => {
    closeAdminScreen();
  });
}

function openAdminScreen() {
  localStorage.setItem("zus_current_view", "admin");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.remove("hidden");

  const adminBtn = document.getElementById("admin-switch-btn");
  const backBtn = document.getElementById("admin-back-btn");
  if (adminBtn) adminBtn.classList.add("hidden");
  if (backBtn) backBtn.classList.remove("hidden");

  renderAdminPendingRequests();
  renderAdminCoffeeHistory();
  renderAdminUsers();
  renderUsageStats();
}

function closeAdminScreen() {
  localStorage.removeItem("zus_current_view");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");

  const adminBtn = document.getElementById("admin-switch-btn");
  const backBtn = document.getElementById("admin-back-btn");
  if (backBtn) backBtn.classList.add("hidden");
  if (adminBtn) adminBtn.classList.remove("hidden");
}

// 14. ADMINISTRACE - ŽÁDOSTI HOSTŮ & ZASLÁNÍ PINU PŘES SMS
function renderAdminPendingRequests() {
  const container = document.getElementById("admin-pending-container");
  const list = document.getElementById("admin-pending-list");
  if (!container || !list) return;

  const pendingUsers = state.users.filter(u => u.pin === "PENDING" || !u.pin);

  if (pendingUsers.length === 0) {
    container.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  list.innerHTML = "";

  pendingUsers.forEach(pu => {
    const div = document.createElement("div");
    div.style = "background:#fff; border:1px solid var(--card-border); padding:8px 10px; border-radius:8px;";
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>${pu.name}</b>
        <span style="font-size:0.85rem; color:var(--text-muted);">Tel: <a href="tel:${pu.phone}">${pu.phone}</a></span>
      </div>
      <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
        <input type="text" id="assign-pin-${pu.id}" placeholder="Zadej PIN" maxlength="4" style="width:75px; padding:4px; text-align:center;">
        <button class="btn btn-primary btn-small" onclick="adminSetPinAndSendSMS(${pu.id}, '${pu.phone}', '${pu.name}')">
          Uložit PIN & Poslat SMS
        </button>
      </div>
    `;
    list.appendChild(div);
  });
}

window.adminSetPinAndSendSMS = async function(userId, phone, name) {
  const pinInput = document.getElementById(`assign-pin-${userId}`);
  const pin = pinInput.value.trim();

  if (!pin || pin.length !== 4) {
    alert("Zadejte prosím 4místný číselný PIN.");
    return;
  }

  const user = state.users.find(u => String(u.id) === String(userId));
  if (user) user.pin = pin;

  // Uložíme PIN na server
  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminSetPin", userId: userId, pin: pin })
  });

  // Otevře nativní SMS aplikaci v mobilu administrátora
  const cleanPhone = phone.replace(/\s+/g, "");
  const smsBody = encodeURIComponent(`Ahoj ${name}, tvuj PIN do kavarenkove aplikace ZUSkafe je: ${pin}. Aplikace: https://mkytaran.github.io/kavarna-zus/`);
  window.location.href = `sms:${cleanPhone}?body=${smsBody}`;

  await loadData();
  renderAdminPendingRequests();
  renderAdminUsers();
};

// 15. ADMINISTRACE - HISTORIE KÁV
function renderAdminCoffeeHistory() {
  const container = document.getElementById("coffee-history-list");
  if (!container) return;
  container.innerHTML = "";

  state.allCoffees.forEach(coffee => {
    const coffeeRatings = state.ratings.filter(r => String(r.kavaId) === String(coffee.id) && r.rating > 0);
    const count = coffeeRatings.length;
    let avg = "0.0";
    let roundAvg = 0;
    if (count > 0) {
      const sum = coffeeRatings.reduce((acc, r) => acc + r.rating, 0);
      avg = (sum / count).toFixed(1);
      roundAvg = Math.round(Number(avg));
    }

    const card = document.createElement("div");
    card.className = `coffee-card-item ${coffee.aktivni === 1 ? "is-active" : ""}`;

    let heartsStr = "";
    for (let i = 1; i <= 5; i++) {
      heartsStr += i <= roundAvg ? "♥" : "♡";
    }

    card.innerHTML = `
      <div class="coffee-card-head" onclick="toggleCoffeeDetail(${coffee.id})">
        <div>
          <div class="coffee-card-title">
            ${coffee.nazev}
            ${coffee.aktivni === 1 ? '<span class="active-pill">☕&nbsp;V&nbsp;kávovaru</span>' : ''}
          </div>
          <div class="coffee-card-stats">
            <b>${avg}</b>
            <span class="hearts">${heartsStr}</span>
            <span>(${count} ${count === 1 ? 'hlas' : count >= 2 && count <= 4 ? 'hlasy' : 'hlasů'})</span>
          </div>
        </div>
        <span id="arrow-${coffee.id}" class="dropdown-arrow">▼</span>
      </div>

      <div id="detail-${coffee.id}" class="coffee-card-details hidden">
        <div class="coffee-profile-row">
          <span>Acidita: ${coffee.acidita}/5</span>
          <span>Intenzita: ${coffee.intenzita}/5</span>
          <span>Pražení: ${coffee.prazeni}/5</span>
        </div>
        <div style="font-weight:700; font-size:0.85rem; margin-top:6px;">Hodnocení od kolegů:</div>
        <div id="votes-${coffee.id}" style="margin-top:4px;">
          ${coffeeRatings.length === 0 ? '<div style="font-size:0.8rem; font-style:italic; color:var(--text-muted);">Zatím nikdo nehodnotil</div>' : ''}
        </div>
        <div class="card-actions">
          ${coffee.aktivni !== 1 ? `<button class="btn btn-primary btn-small" onclick="setActiveCoffee(${coffee.id})">Znovu nasadit do mlýnku</button>` : ''}
        </div>
      </div>
    `;

    container.appendChild(card);

    const votesContainer = card.querySelector(`#votes-${coffee.id}`);
    coffeeRatings.forEach(r => {
      const vRow = document.createElement("div");
      vRow.className = "rating-user-row";
      vRow.innerHTML = `
        <span>${r.userName}</span>
        <span class="rating-user-hearts">${"♥".repeat(r.rating)}${"♡".repeat(5 - r.rating)}</span>
      `;
      votesContainer.appendChild(vRow);
    });
  });
}

window.toggleCoffeeDetail = function(id) {
  const el = document.getElementById(`detail-${id}`);
  const arrow = document.getElementById(`arrow-${id}`);
  if (el) el.classList.toggle("hidden");
  if (arrow) arrow.classList.toggle("rotated");
};

window.setActiveCoffee = async function(id) {
  const chosen = state.allCoffees.find(c => String(c.id) === String(id));
  if (!chosen) return;

  state.allCoffees.forEach(c => c.aktivni = (String(c.id) === String(id) ? 1 : 0));
  state.kava = chosen;
  localStorage.setItem("zus_cached_kava", JSON.stringify(chosen));

  renderCoffeeBadge();
  initRating();
  renderAdminCoffeeHistory();

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "setActiveCoffee", id: id })
  });
  alert(`Káva "${chosen.nazev}" byla nastavena jako aktivní!`);
};

const adminSaveCoffeeBtn = document.getElementById("admin-save-coffee");
if (adminSaveCoffeeBtn) {
  adminSaveCoffeeBtn.addEventListener("click", async () => {
    const nazev = document.getElementById("admin-coffee-name").value.trim();
    const acidita = Number(document.getElementById("admin-acidita").value);
    const intenzita = Number(document.getElementById("admin-intenzita").value);
    const prazeni = Number(document.getElementById("admin-prazeni").value);

    if (!nazev) { alert("Zadej prosím název nové kávy."); return; }

    const newId = state.allCoffees.length > 0 ? Math.max(...state.allCoffees.map(c => c.id)) + 1 : 1;
    const newCoffee = {
      id: newId,
      nazev: nazev,
      acidita: acidita,
      intenzita: intenzita,
      prazeni: prazeni,
      aktivni: 1
    };

    state.allCoffees.forEach(c => c.aktivni = 0);
    state.allCoffees.unshift(newCoffee);
    state.kava = newCoffee;
    localStorage.setItem("zus_cached_kava", JSON.stringify(newCoffee));

    renderCoffeeBadge();
    initRating();
    renderAdminCoffeeHistory();
    document.getElementById("admin-coffee-name").value = "";

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "saveCoffee",
        isNew: true,
        nazev: nazev,
        acidita: acidita,
        intenzita: intenzita,
        prazeni: prazeni
      })
    });
    alert(`Nová káva "${nazev}" byla uložena do historie a nasazena do kávovaru!`);
  });
}

// 16. ADMINISTRACE - CENA KÁVY
const adminSavePriceBtn = document.getElementById("admin-save-price");
if (adminSavePriceBtn) {
  adminSavePriceBtn.addEventListener("click", async () => {
    const newPrice = Number(document.getElementById("admin-coffee-price").value);
    if (!newPrice || newPrice <= 0) { alert("Zadejte platnou cenu."); return; }

    state.finance.cenaKavy = newPrice;

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "saveCoffeePrice", cena: newPrice })
    });

    alert(`Cena za 1 kávu byla uložena na ${newPrice} Kč.`);
  });
}

// 17. ADMINISTRACE - SPRÁVA UŽIVATELŮ
function renderAdminUsers() {
  const tbody = document.getElementById("admin-user-list");
  const select = document.getElementById("payment-user");
  
  if (tbody) tbody.innerHTML = "";
  if (select) {
    select.innerHTML = '<option value="">-- Vyber kafaře --</option><option value="NEW" style="font-weight: bold; color: var(--accent);">+ Přidat nového kafaře...</option>';
  }

  state.users.forEach(u => {
    if (select) {
      const option = document.createElement("option");
      option.value = u.id;
      option.textContent = u.name;
      select.appendChild(option);
    }

    if (tbody) {
      const balance = Number(u.prepaid) - Number(u.drank);
      const isDebt = balance < 0;
      const statusColor = isDebt ? "var(--heart-active)" : "var(--text-main)";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight:700;">
          ${u.name} <span style="font-size:0.7rem; color:var(--text-muted); font-weight:normal;">(${u.pin === 'PENDING' ? 'Čeká na PIN' : 'PIN: ' + u.pin})</span><br>
          <span style="font-size:0.75rem; color:${statusColor}; font-weight:800;">
            Zůstatek: ${balance}
          </span>
        </td>
        <td style="white-space:nowrap;">
          <input type="number" id="d-${u.id}" value="${u.drank}" style="width:36px; padding:2px;">
          / <input type="number" id="p-${u.id}" value="${u.prepaid}" style="width:36px; padding:2px;">
        </td>
        <td><input type="number" id="tp-${u.id}" value="${u.totalPaid}" style="width:55px;"></td>
        <td style="text-align:center; font-weight:800; color:var(--primary);">${u.totalDrank}</td>
        <td><button class="btn btn-primary" style="padding: 6px; font-size: 0.75rem;" onclick="adminSaveUser(${u.id})">Uložit</button></td>
      `;
      tbody.appendChild(tr);
    }
  });
}

const paymentUserSelect = document.getElementById("payment-user");
if (paymentUserSelect) {
  paymentUserSelect.addEventListener("change", (e) => {
    const newUserFields = document.getElementById("new-user-fields");
    if (e.target.value === "NEW") {
      newUserFields.classList.remove("hidden");
    } else {
      newUserFields.classList.add("hidden");
    }
  });
}

const adminCreateUserBtn = document.getElementById("admin-create-user-btn");
if (adminCreateUserBtn) {
  adminCreateUserBtn.addEventListener("click", async () => {
    const name = document.getElementById("new-user-name").value.trim();
    const pin = document.getElementById("new-user-pin").value.trim();
    const phone = document.getElementById("new-user-phone").value.trim();

    if (!name || !pin || pin.length !== 4) {
      alert("Zadejte prosím platné jméno a čtyřmístný PIN.");
      return;
    }

    document.getElementById("new-user-name").value = "";
    document.getElementById("new-user-pin").value = "";
    document.getElementById("new-user-phone").value = "";
    document.getElementById("new-user-fields").classList.add("hidden");

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "addUser", name: name, pin: pin, phone: phone })
    });

    await loadData();
    renderAdminUsers();
    renderUsageStats();
    alert(`Nový kafař "${name}" byl úspěšně přidán!`);
  });
}

const adminSavePaymentBtn = document.getElementById("admin-save-payment");
if (adminSavePaymentBtn) {
  adminSavePaymentBtn.addEventListener("click", async () => {
    const userId = document.getElementById("payment-user").value;
    const amount = document.getElementById("payment-amount").value;
    if (!userId || userId === "NEW" || !amount) { alert("Vyplň platného kafaře i částku."); return; }

    const u = state.users.find(x => String(x.id) === userId);
    if (!u) return;

    document.getElementById("payment-amount").value = "";

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "addPayment", userId: userId, amount: amount })
    });

    await loadData(); 
    renderUsageStats(); 
    alert(`Připsáno ${amount} Kč uživateli ${u.name}.`);
  });
}

window.adminSaveUser = async function(id) {
  const drk = Number(document.getElementById(`d-${id}`).value);
  const prep = Number(document.getElementById(`p-${id}`).value);
  const tPaid = Number(document.getElementById(`tp-${id}`).value);
  
  const u = state.users.find(x => String(x.id) === String(id));
  if (!u) return;

  if (state.currentUser && String(state.currentUser.id) === String(id)) {
    const diff = drk - Number(u.drank);
    state.todayDrank = Math.max(0, state.todayDrank + diff);
    saveDailyBadge();
  }

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk, totalPaid: tPaid })
  });
  
  await loadData(); 
  renderUsageStats(); 
  alert(`Uloženo: ${u.name}`);
};

// 18. PŘEHLEDY TÝDNE A MĚSÍCE
function getWorkingDaysInCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let count = 0;
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    if (date.getDay() !== 0 && date.getDay() !== 6) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
}

function renderUsageStats() {
  const weeklyContainer = document.getElementById("admin-weekly-list");
  const monthlyContainer = document.getElementById("admin-monthly-list");
  if (!weeklyContainer || !monthlyContainer) return;

  weeklyContainer.innerHTML = "";
  monthlyContainer.innerHTML = "";

  const now = new Date();
  const currentDay = now.getDay() === 0 ? 7 : now.getDay();
  const mondayThisWeek = new Date(now);
  mondayThisWeek.setDate(now.getDate() - currentDay + 1);
  mondayThisWeek.setHours(0,0,0,0);

  const workingDaysInMonth = getWorkingDaysInCurrentMonth();
  const currentMonthStr = now.getFullYear() + "-" + now.getMonth();

  const weeklyStats = {};
  const monthlyStats = {};
  
  state.users.forEach(u => {
    weeklyStats[u.id] = [0,0,0,0,0]; 
    monthlyStats[u.id] = 0;
  });

  state.logs.forEach(log => {
    const d = new Date(log.date);
    
    if (d >= mondayThisWeek) {
      let dIndex = d.getDay() === 0 ? 6 : d.getDay() - 1; 
      if (dIndex <= 4 && weeklyStats[log.userId]) {
        weeklyStats[log.userId][dIndex] += log.diff;
      }
    }
    
    if (d.getFullYear() + "-" + d.getMonth() === currentMonthStr && monthlyStats[log.userId] !== undefined) {
      monthlyStats[log.userId] += log.diff;
    }
  });

  const miniCupSVG = `<svg viewBox="0 0 24 24"><path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/></svg>`;
  
  state.users.forEach(u => {
    const wData = weeklyStats[u.id];
    let cupsHtml = "";
    
    wData.forEach(cupsDrank => {
      let isDrankClass = cupsDrank > 0 ? "drank" : "";
      let badgeHtml = cupsDrank > 1 ? `<div class="multi-cup-badge">${cupsDrank}</div>` : "";
      
      cupsHtml += `
        <div class="day-cup-wrapper">
          <div class="day-cup ${isDrankClass}">${miniCupSVG}</div>
          ${badgeHtml}
        </div>
      `;
    });

    weeklyContainer.innerHTML += `
      <div class="stat-row">
        <div class="stat-name">${u.name}</div>
        <div class="week-cups">${cupsHtml}</div>
      </div>
    `;

    const mDrank = monthlyStats[u.id];
    monthlyContainer.innerHTML += `
      <div class="stat-row">
        <div class="stat-name">${u.name}</div>
        <div class="month-stat">${mDrank} / ${workingDaysInMonth}</div>
      </div>
    `;
  });
}

// Osvěžení dat při rozbalení detailů
document.querySelectorAll(".admin-details").forEach(detail => {
  detail.addEventListener("toggle", () => {
    if (detail.open) {
      renderUsageStats();
      renderAdminUsers();
      renderAdminPendingRequests();
    }
  });
});

// START APLIKACE
tryInstantAutoLogin();
restoreCachedCoffeeData();
loadData();