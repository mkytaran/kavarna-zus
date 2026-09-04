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

// SVG šablona jednoho kávového zrna se středovou rýhou
function createBeanSVG(isActive) {
  return `
    <svg viewBox="0 0 30 30" class="bean-svg ${isActive ? 'active' : 'inactive'}">
      <ellipse cx="15" cy="15" rx="10" ry="13" class="bean-body" transform="rotate(-25 15 15)" />
      <path d="M 12 4 Q 17 15 13 26" class="bean-crease" fill="none" stroke-width="2.2" stroke-linecap="round" />
    </svg>
  `;
}

let state = {
  users: [],
  finance: {},
  kava: {
    nazev: "Brasil Pergamino Sul de Minas",
    acidita: 2,
    intenzita: 4,
    prazeni: 3
  },
  currentUser: null,
  clicksInSession: 0
};

// Registrace Service Workeru pro PWA instalaci
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW reg failed: ", err));
  });
}

// 1. SPRÁVA BAREVNÉHO REŽIMU (Světlý / Tmavý / Systém)
const themeBtn = document.getElementById("theme-btn");

function initTheme() {
  const saved = localStorage.getItem("zus_theme") || "system";
  applyTheme(saved);
}

function applyTheme(theme) {
  if (theme === "system") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("zus_theme", next);
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  if (localStorage.getItem("zus_theme") === "system") {
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  }
});

// 2. OKAMŽITÉ PŘIHLÁŠENÍ ZE ZÁLOHY (Bez probliknutí)
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

// 3. NAČTENÍ DAT ZE SERVERU A SYNCHRONIZACE
async function loadData() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getData`);
    const data = await res.json();
    state.users = data.users || [];
    state.finance = data.finance || {};
    if (data.kava) state.kava = data.kava;

    renderCoffeeBadge();
    renderFinance();

    // Pokud je uživatel přihlášen, aktualizujeme jeho data z tabulky
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
    console.error("Chyba při synchronizaci se serverem:", err);
  }
}

// Manuální přihlášení
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

// Odhlášení
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

// 4. KÁVOVÝ ŠTÍTEK (5 zrnek na řádek)
function renderBeansMeter(containerId, value) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    container.innerHTML += createBeanSVG(i <= value);
  }
}

function renderCoffeeBadge() {
  document.getElementById("coffee-name").textContent = state.kava.nazev;
  renderBeansMeter("beans-acidita", state.kava.acidita);
  renderBeansMeter("beans-intenzita", state.kava.intenzita);
  renderBeansMeter("beans-prazeni", state.kava.prazeni);
}

// 5. HODNOCENÍ VELKÝMI SRDÍČKY
function initRating() {
  const hearts = document.querySelectorAll("#hearts-container .heart-btn");
  const savedRating = localStorage.getItem(`zus_rating_${state.kava.nazev}`) || 0;
  paintHearts(savedRating);

  hearts.forEach(btn => {
    btn.onclick = () => {
      const val = Number(btn.getAttribute("data-val"));
      localStorage.setItem(`zus_rating_${state.kava.nazev}`, val);
      paintHearts(val);
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
  document.getElementById("rating-text").textContent = RATING_DESCRIPTIONS[val] || "Klepni na srdíčko";
}

// 6. ODKLIKNUTÍ VYPITÉ KÁVY & POJISTKA PROTI PŘEKLIKNUTÍ
const cupAction = document.getElementById("cup-action");
const undoBtn = document.getElementById("undo-btn");

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

  // Vrácení umožníme pouze při 2 a více kliknutích během aktuální relace
  if (state.clicksInSession > 1) {
    undoBtn.classList.remove("hidden");
  }
});

undoBtn.addEventListener("click", () => {
  const u = state.currentUser;
  if (state.clicksInSession > 1) {
    u.drank -= 1;
    state.clicksInSession -= 1;
    updateCupsView();
    syncDrankToServer(u.id, u.drank);

    // Pokud zbývá pouze 1 legitimní káva, tlačítko vrátit skryjeme
    if (state.clicksInSession <= 1) {
      undoBtn.classList.add("hidden");
    }
  }
});

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

// 7. DYNAMICKÁ MŘÍŽKA ŠÁLKŮ PODLE VÝŠE PŘEDPLATNÉHO
function updateCupsView() {
  const u = state.currentUser;
  const totalCups = u.prepaid || 0;
  document.getElementById("cups-count-text").textContent = `${u.drank} / ${totalCups}`;

  const grid = document.getElementById("cups-grid");
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

  // Velký šálek
  const liquid = document.getElementById("liquid");
  if (liquid) {
    if (u.drank >= totalCups) {
      liquid.style.opacity = "0.15";
    } else {
      liquid.style.opacity = "1";
    }
  }
}

// 8. POKLADNA
function renderFinance() {
  const vybrano = state.finance.vybrano || 0;
  const naklady = (state.finance.naklady || 0) + (state.finance.doprava || 0);
  const rozdil = vybrano - naklady;

  document.getElementById("fin-vybrano").textContent = `${vybrano} Kč`;
  document.getElementById("fin-naklady").textContent = `${naklady} Kč`;
  document.getElementById("fin-rozdil").textContent = `${rozdil} Kč`;
}

// 9. ADMIN PANEL
document.getElementById("admin-switch-btn").addEventListener("click", () => {
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("bottom-bar").classList.add("hidden");
  document.getElementById("admin-view").classList.remove("hidden");

  document.getElementById("admin-coffee-name").value = state.kava.nazev;
  document.getElementById("admin-acidita").value = state.kava.acidita;
  document.getElementById("admin-intenzita").value = state.kava.intenzita;
  document.getElementById("admin-prazeni").value = state.kava.prazeni;

  renderAdminUsers();
});

document.getElementById("admin-back-btn").addEventListener("click", () => {
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  document.getElementById("bottom-bar").classList.remove("hidden");
});

function renderAdminUsers() {
  const tbody = document.getElementById("admin-user-list");
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
  u.prepaid = prep;
  u.drank = drk;

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk })
  });
  alert(`Uloženo: ${u.name}`);
};

document.getElementById("admin-save-coffee").addEventListener("click", async () => {
  state.kava.nazev = document.getElementById("admin-coffee-name").value;
  state.kava.acidita = Number(document.getElementById("admin-acidita").value);
  state.kava.intenzita = Number(document.getElementById("admin-intenzita").value);
  state.kava.prazeni = Number(document.getElementById("admin-prazeni").value);

  renderCoffeeBadge();

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "updateCoffeeInfo",
      nazev: state.kava.nazev,
      acidita: state.kava.acidita,
      intenzita: state.kava.intenzita,
      prazeni: state.kava.prazeni
    })
  });
  alert("Kávový štítek aktualizován!");
});

// Inicializace
initTheme();
tryInstantAutoLogin();
loadData();