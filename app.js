// URL vašeho Google Apps Script Web App
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwEDpLlUikYhMCJlolZZOgwqI8Gb_gMOYLwE4FDUtgD7hMIcHFGywGMwVG4pNNLRLU5CA/exec";

// Popisky hodnocení kávy srdíčky
const RATING_DESCRIPTIONS = {
  1: "1 – Nechutná mi",
  2: "2 – Nic moc",
  3: "3 – Dobrá",
  4: "4 – Fajn kafe",
  5: "5 – Skvělý kafe"
};

// Buclaté kávové zrno s decentní zkrácenou esovitou rýhou
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
  clicksInSession: 0
};

// Registrace Service Workeru pro PWA instalaci
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW reg failed: ", err));
  });
}

// 1. TÉMA A SYSTÉMOVÉ LIŠTY
const themeBtn = document.getElementById("theme-btn");

function initTheme() {
  const saved = localStorage.getItem("zus_theme") || "system";
  applyTheme(saved);
}

function applyTheme(theme) {
  let effectiveTheme = theme;
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    effectiveTheme = isDark ? "dark" : "light";
  }

  // Nastavíme atribut pro CSS proměnné a color-scheme
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  document.documentElement.style.colorScheme = effectiveTheme;

  // Cílová barva lišty
  const targetColor = effectiveTheme === "dark" ? "#1c1714" : "#f5eee6";

  // Spolehlivá aktualizace meta tagu pro Android/Chrome
  let meta = document.getElementById("theme-color-meta");
  if (!meta) {
    meta = document.querySelector('meta[name="theme-color"]');
  }

  if (meta) {
    meta.removeAttribute("media"); // Odstraní podmínku, aby platil bez ohledu na režim OS
    meta.setAttribute("content", targetColor);
  } else {
    meta = document.createElement("meta");
    meta.id = "theme-color-meta";
    meta.name = "theme-color";
    meta.content = targetColor;
    document.head.appendChild(meta);
  }
}

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("zus_theme", next);
  applyTheme(next);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  if (localStorage.getItem("zus_theme") === "system") {
    applyTheme("system");
  }
});

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("zus_theme", next);
  applyTheme(next);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  if (localStorage.getItem("zus_theme") === "system") {
    applyTheme("system");
  }
});

// 2. MEZIPAMĚŤ PRO OKAMŽITÉ ZOBRAZENÍ BEZ ČEKÁNÍ NA SÍŤ
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

// 3. PŘIHLÁŠENÍ ZE ZÁLOHY
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
}

// 4. NAČTENÍ DAT ZE SERVERU S BLOKACÍ ZDVOJENÉHO HODNOCENÍ
async function loadData() {
  const ratingBox = document.querySelector(".rating-box");
  if (ratingBox) ratingBox.classList.add("is-syncing");

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
    if (ratingBox) ratingBox.classList.remove("is-syncing");
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
  localStorage.removeItem("zus_saved_user");
  document.getElementById("login-name").value = "";
  document.getElementById("login-pin").value = "";
  document.getElementById("logout-btn").classList.add("hidden");
  document.getElementById("bottom-bar").classList.add("hidden");
  document.getElementById("undo-btn").classList.add("hidden");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
});

// 5. KÁVOVÝ ŠTÍTEK
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

// 6. HODNOCENÍ SRDÍČKY
function initRating() {
  const hearts = document.querySelectorAll("#hearts-container .heart-btn");
  let myRating = 0;

  if (state.currentUser && state.kava) {
    const found = state.ratings.find(
      r => r.kavaId === state.kava.id && String(r.userId) === String(state.currentUser.id)
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
        r => r.kavaId === state.kava.id && String(r.userId) === String(state.currentUser.id)
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
  const labelEl = document.getElementById("rating-text");
  if (labelEl) {
    labelEl.textContent = RATING_DESCRIPTIONS[val] || "Klepni na srdíčko";
  }
}

// 7. ODKLIKÁVÁNÍ KÁVY
const cupAction = document.getElementById("cup-action");
const undoBtn = document.getElementById("undo-btn");

if (cupAction) {
  cupAction.addEventListener("click", () => {
    const u = state.currentUser;
    if (!u) return;

    if (u.drank >= u.prepaid) {
      alert("Všechny předplacené kávy máš vyčerpané. Nahlaste správci nové předplatné.");
      return;
    }

    u.drank += 1;
    state.clicksInSession += 1;

    updateCupsView();
    syncDrankToServer(u.id, u.drank);

    if (state.clicksInSession > 1 && undoBtn) {
      undoBtn.classList.remove("hidden");
    }
  });
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    const u = state.currentUser;
    if (state.clicksInSession > 1) {
      u.drank -= 1;
      state.clicksInSession -= 1;
      updateCupsView();
      syncDrankToServer(u.id, u.drank);

      if (state.clicksInSession <= 1) {
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

// 8. DYNAMICKÁ MŘÍŽKA ŠÁLKŮ
function updateCupsView() {
  const u = state.currentUser;
  if (!u) return;

  const totalCups = u.prepaid || 0;
  const countText = document.getElementById("cups-count-text");
  if (countText) countText.textContent = `${u.drank} / ${totalCups}`;

  const grid = document.getElementById("cups-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const miniCupSVG = `
    <svg viewBox="0 0 24 24">
      <path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/>
    </svg>
  `;

  for (let i = 1; i <= totalCups; i++) {
    const div = document.createElement("div");
    div.classList.add("mini-cup");
    div.innerHTML = miniCupSVG;

    if (i <= u.drank) {
      div.classList.add("empty");
    } else {
      div.classList.add("full");
    }
    grid.appendChild(div);
  }

  const liquid = document.getElementById("liquid");
  if (liquid) {
    liquid.style.opacity = u.drank >= totalCups ? "0.15" : "1";
  }
}

// 9. POKLADNA
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

// 10. ADMIN KARTOTÉKA KÁV
const adminSwitchBtn = document.getElementById("admin-switch-btn");
if (adminSwitchBtn) {
  adminSwitchBtn.addEventListener("click", () => {
    document.getElementById("main-view").classList.add("hidden");
    document.getElementById("bottom-bar").classList.add("hidden");
    document.getElementById("admin-view").classList.remove("hidden");

    renderAdminCoffeeHistory();
    renderAdminUsers();
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
    const coffeeRatings = state.ratings.filter(r => r.kavaId === coffee.id && r.rating > 0);
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
  const chosen = state.allCoffees.find(c => c.id === id);
  if (!chosen) return;

  state.allCoffees.forEach(c => c.aktivni = (c.id === id ? 1 : 0));
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

    if (!nazev) {
      alert("Zadej prosím název nové kávy.");
      return;
    }

    const newId = state.allCoffees.length + 1;
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

function renderAdminUsers() {
  const tbody = document.getElementById("admin-user-list");
  if (!tbody) return;
  tbody.innerHTML = "";
  state.users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.name}</td>
      <td><input type="number" id="p-${u.id}" value="${u.prepaid}"></td>
      <td><input type="number" id="d-${u.id}" value="${u.drank}"></td>
      <td><button class="btn btn-primary" style="padding: 6px 10px; font-size: 0.85rem;" onclick="adminSaveUser(${u.id})">Uložit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.adminSaveUser = async function(id) {
  const prep = Number(document.getElementById(`p-${id}`).value);
  const drk = Number(document.getElementById(`d-${id}`).value);
  const u = state.users.find(x => x.id == id);
  if (!u) return;
  u.prepaid = prep;
  u.drank = drk;

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk })
  });
  alert(`Uloženo: ${u.name}`);
};

// Start aplikace
initTheme();
restoreCachedCoffeeData();
tryInstantAutoLogin();
loadData();