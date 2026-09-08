// URL vašeho Google Apps Script Web App
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwEDpLlUikYhMCJlolZZOgwqI8Gb_gMOYLwE4FDUtgD7hMIcHFGywGMwVG4pNNLRLU5CA/exec";

const CENA_KAVY = 10;

function createBeanSVG(isActive) {
  return `
    <svg viewBox="0 0 30 30" class="bean-svg ${isActive ? 'active' : 'inactive'}">
      <ellipse cx="15" cy="15" rx="11.5" ry="13.5" class="bean-body" transform="rotate(-25 15 15)" />
      <path d="M 10.5 8 C 13.5 11.5, 13 14.5, 15 17 C 16.8 19.2, 16.5 21, 19.5 22.5" 
            class="bean-crease" 
            fill="none" 
            stroke-width="3.2" 
            stroke-linecap="round" />
    </svg>
  `;
}

let state = {
  users: [],
  finance: {},
  kava: { id: 1, nazev: "Brasil Pergamino Sul de Minas", acidita: 2, intenzita: 4, prazeni: 3, aktivni: 1 },
  allCoffees: [],
  ratings: [],
  currentUser: null,
  clicksInSession: 0,
  todayDrank: 0,
  logs: []
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW reg failed: ", err));
  });
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
      initRating();
    }
  } catch (e) {
    console.warn("Chyba čtení z mezipaměti:", e);
  }
}

function tryInstantAutoLogin() {
  const savedUser = localStorage.getItem("zus_saved_user");
  if (!savedUser) return;
  try {
    const parsed = JSON.parse(savedUser);
    if (parsed && parsed.name && parsed.pin) {
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
  document.getElementById("logout-btn").classList.remove("hidden");

  const bottomBar = document.getElementById("bottom-bar");
  const adminBtn = document.getElementById("admin-switch-btn");

  if (user.role === "admin") {
    bottomBar.classList.remove("hidden");
    adminBtn.classList.remove("hidden");
  } else {
    bottomBar.classList.add("hidden");
    adminBtn.classList.add("hidden");
  }

  updateCupsView();
  initRating();
  syncDailyBadge();
}

async function loadData() {
  const syncRow = document.querySelector(".rating-box");
  if (syncRow) syncRow.classList.add("is-syncing");

  try {
    const res = await fetch(`${SCRIPT_URL}?action=getData`);
    const data = await res.json();

    state.users = data.users || [];
    state.finance = data.finance || {};
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

    const savedUser = localStorage.getItem("zus_saved_user");
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      const freshUser = state.users.find(
        u => u.name.toLowerCase() === parsed.name.toLowerCase() && String(u.pin) === String(parsed.pin)
      );
      if (freshUser) {
        state.currentUser = freshUser;
        localStorage.setItem("zus_saved_user", JSON.stringify(freshUser));
        updateCupsView();
      }
    }
  } catch (err) {
    console.error("Chyba při synchronizaci:", err);
  } finally {
    if (syncRow) syncRow.classList.remove("is-syncing");
  }
}

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

document.getElementById("logout-btn").addEventListener("click", () => {
  state.currentUser = null;
  state.clicksInSession = 0;
  state.todayDrank = 0;
  
  localStorage.removeItem("zus_saved_user");
  document.getElementById("login-name").value = "";
  document.getElementById("login-pin").value = "";
  document.getElementById("logout-btn").classList.add("hidden");
  document.getElementById("bottom-bar").classList.add("hidden");
  document.getElementById("undo-btn").classList.add("hidden");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
  
  renderDailyBadge(); 
});

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

function initRating() {
  const hearts = document.querySelectorAll("#hearts-container .heart-btn");
  let myRating = 0;

  if (state.currentUser && state.kava) {
    const found = state.ratings.find(
      r => String(r.kavaId) === String(state.kava.id) && String(r.userId) === String(state.currentUser.id)
    );
    if (found) myRating = found.rating;
  }

  paintHearts(myRating);

  hearts.forEach(btn => {
    btn.onclick = async () => {
      const val = Number(btn.getAttribute("data-val"));
      if (!state.currentUser || !state.kava) return;

      paintHearts(val);

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

const cupAction = document.getElementById("cup-action");
const undoBtn = document.getElementById("undo-btn");

if (cupAction) {
  cupAction.addEventListener("click", () => {
    const u = state.currentUser;
    if (!u) return;

    u.drank += 1;
    state.clicksInSession += 1;
    state.todayDrank += 1;
    
    saveDailyBadge(); 
    updateCupsView();
    syncDrankToServer(u.id, u.drank);

    if (state.clicksInSession > 0 && undoBtn) {
      undoBtn.classList.remove("hidden");
    }
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    const u = state.currentUser;
    if (state.clicksInSession > 0) {
      u.drank -= 1;
      state.clicksInSession -= 1;
      
      if (state.todayDrank > 0) {
        state.todayDrank -= 1;
        saveDailyBadge();
      }

      updateCupsView();
      syncDrankToServer(u.id, u.drank);

      if (state.clicksInSession === 0) {
        undoBtn.classList.add("hidden");
      }
    }
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

function updateCupsView() {
  const u = state.currentUser;
  if (!u) return;

  const totalCups = Number(u.prepaid) || 0;
  const drankCups = Number(u.drank) || 0;
  
  const balance = totalCups - drankCups;
  const balanceMoney = balance * CENA_KAVY;

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

const adminSwitchBtn = document.getElementById("admin-switch-btn");
if (adminSwitchBtn) {
  adminSwitchBtn.addEventListener("click", () => {
    document.getElementById("main-view").classList.add("hidden");
    document.getElementById("bottom-bar").classList.add("hidden");
    document.getElementById("admin-view").classList.remove("hidden");

    renderAdminCoffeeHistory();
    renderAdminUsers();
    renderUsageStats();
  });
}

const adminBackBtn = document.getElementById("admin-back-btn");
if (adminBackBtn) {
  adminBackBtn.addEventListener("click", () => {
    document.getElementById("admin-view").classList.add("hidden");
    document.getElementById("main-view").classList.remove("hidden");
    document.getElementById("bottom-bar").classList.remove("hidden");
  });
}

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
            ${coffee.aktivni === 1 ? '<span class="active-pill">V kávovaru</span>' : ''}
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

// 10. TABULKA UŽIVATELŮ A PLATBY (vč. zobrazení PINů a přidání nového kafaře)
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
          ${u.name} <span style="font-size:0.7rem; color:var(--text-muted); font-weight:normal;">(PIN: ${u.pin})</span><br>
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

// Sledování výběru v roletce plateb (zobrazení políček pro nového kafaře)
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

// Akce pro uložení nového kafaře
const adminCreateUserBtn = document.getElementById("admin-create-user-btn");
if (adminCreateUserBtn) {
  adminCreateUserBtn.addEventListener("click", async () => {
    const name = document.getElementById("new-user-name").value.trim();
    const pin = document.getElementById("new-user-pin").value.trim();

    if (!name || !pin || pin.length !== 4) {
      alert("Zadejte prosím platné jméno a čtyřmístný PIN.");
      return;
    }

    document.getElementById("new-user-name").value = "";
    document.getElementById("new-user-pin").value = "";
    document.getElementById("new-user-fields").classList.add("hidden");

    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "addUser", name: name, pin: pin })
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

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk, totalPaid: tPaid })
  });
  
  await loadData(); 
  renderUsageStats(); 
  alert(`Uloženo: ${u.name}`);
};

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

// Start aplikace
restoreCachedCoffeeData();
tryInstantAutoLogin();
loadData();