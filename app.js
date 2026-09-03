// URL vašeho Google Apps Script Web App
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwEDpLlUikYhMCJlolZZOgwqI8Gb_gMOYLwE4FDUtgD7hMIcHFGywGMwVG4pNNLRLU5CA/exec";

// Popisky hodnocení kávy M
const RATING_DESCRIPTIONS = {
  1: "1 – Nechutná mi",
  2: "2 – Nic moc",
  3: "3 – Dobrá",
  4: "4 – Fajn kafe",
  5: "5 – Skvělý kafe"
};

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
  // Evidence kliknutí během jedné návštěvy pro pojistku proti překliknutí
  clicksInSession: 0 
};

// 1. TÉMA (Light / Dark / Systém)
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

// Sledování systémové změny
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
  if (localStorage.getItem("zus_theme") === "system") {
    document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
  }
});

// 2. NAČTENÍ DAT A PŘIHLÁŠENÍ S PAMĚTÍ
async function loadData() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getData`);
    const data = await res.json();
    state.users = data.users || [];
    state.finance = data.finance || {};
    if (data.kava) state.kava = data.kava;

    renderCoffeeBadge();
    renderFinance();
    checkAutoLogin();
  } catch (err) {
    console.error("Chyba při stahování:", err);
    // Offline fallback pro testování vzhledu
    checkAutoLogin();
  }
}

function checkAutoLogin() {
  const savedUser = localStorage.getItem("zus_saved_user");
  if (savedUser) {
    const parsed = JSON.parse(savedUser);
    const user = state.users.find(u => u.name.toLowerCase() === parsed.name.toLowerCase() && String(u.pin) === String(parsed.pin));
    if (user) {
      loginUser(user, true);
    }
  }
}

document.getElementById("login-btn").addEventListener("click", () => {
  const name = document.getElementById("login-name").value.trim();
  const pin = document.getElementById("login-pin").value.trim();
  const remember = document.getElementById("remember-me").checked;

  const user = state.users.find(u => u.name.toLowerCase() === name.toLowerCase() && String(u.pin) === pin);
  
  if (user) {
    if (remember) {
      localStorage.setItem("zus_saved_user", JSON.stringify({ name: user.name, pin: user.pin }));
    } else {
      localStorage.removeItem("zus_saved_user");
    }
    loginUser(user, false);
  } else {
    alert("Nesprávné jméno nebo PIN. Zkontroluj velké/malé písmena.");
  }
});

function loginUser(user, isAuto) {
  state.currentUser = user;
  state.clicksInSession = 0;
  
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  document.getElementById("user-greeting").textContent = `Ahoj, ${user.name}!`;

  if (user.role === "admin") {
    document.getElementById("admin-switch-btn").classList.remove("hidden");
  }

  updateCupsView();
  initRating();
}

// 3. VYKRESLENÍ KÁVOVÉHO ŠTÍTKU (Zrna 1–5)
function getBeansString(count) {
  // Plná zrnka a prázdná
  return "🫘".repeat(Math.min(count, 5)) + "◦".repeat(Math.max(0, 5 - count));
}

function renderCoffeeBadge() {
  document.getElementById("coffee-name").textContent = state.kava.nazev;
  document.getElementById("beans-acidita").textContent = getBeansString(state.kava.acidita);
  document.getElementById("beans-intenzita").textContent = getBeansString(state.kava.intenzita);
  document.getElementById("beans-prazeni").textContent = getBeansString(state.kava.prazeni);
}

// 4. HODNOCENÍ SRDÍČKY
function initRating() {
  const hearts = document.querySelectorAll("#hearts-container .heart");
  const savedRating = localStorage.getItem(`zus_rating_${state.kava.nazev}`) || 0;

  paintHearts(savedRating);

  hearts.forEach(h => {
    h.onclick = () => {
      const val = Number(h.getAttribute("data-val"));
      localStorage.setItem(`zus_rating_${state.kava.nazev}`, val);
      paintHearts(val);
    };
  });
}

function paintHearts(val) {
  const hearts = document.querySelectorAll("#hearts-container .heart");
  hearts.forEach(h => {
    const hVal = Number(h.getAttribute("data-val"));
    if (hVal <= val) {
      h.classList.add("active");
    } else {
      h.classList.remove("active");
    }
  });
  const textEl = document.getElementById("rating-text");
  textEl.textContent = RATING_DESCRIPTIONS[val] || "Klepni na srdíčko";
}

// 5. ODKLIKNUTÍ VYPITÉ KÁVY & POJISTKA PROTI OMYLU
const cupAction = document.getElementById("cup-action");
const undoBtn = document.getElementById("undo-btn");

cupAction.addEventListener("click", () => {
  const u = state.currentUser;
  if (!u) return;

  if (u.drank >= u.prepaid) {
    alert("Všech 20 káv vyčerpáno. Nahlaste adminovi nové předplatné.");
    return;
  }

  u.drank += 1;
  state.clicksInSession += 1;

  updateCupsView();
  syncDrankToServer(u.id, u.drank);

  // Zobrazíme tlačítko vrátit, pouze pokud uživatel v této relaci kliknul 2× a více
  if (state.clicksInSession > 1) {
    undoBtn.classList.remove("hidden");
  }
});

undoBtn.addEventListener("click", () => {
  const u = state.currentUser;
  // Povoleno vrátit pouze pokud klikl vícekrát v jedné relaci (minimálně 1 kávu musí nechat vypitou)
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

// 6. VYKRESLENÍ 20 MALÝCH ŠÁLKŮ
function updateCupsView() {
  const u = state.currentUser;
  document.getElementById("cups-count-text").textContent = `${u.drank} / ${u.prepaid}`;

  const grid = document.getElementById("cups-grid");
  grid.innerHTML = "";

  const miniCupSVG = `
    <svg viewBox="0 0 24 24">
      <path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3z"/>
    </svg>
  `;

  // Vygenerujeme přesně 20 pozic
  for (let i = 1; i <= 20; i++) {
    const div = document.createElement("div");
    div.classList.add("mini-cup");
    div.innerHTML = miniCupSVG;

    // Vypité šálky zešednou a zesvětlají
    if (i <= u.drank) {
      div.classList.add("empty");
    } else {
      div.classList.add("full");
    }
    grid.appendChild(div);
  }

  // Velký šálek
  const liquid = document.getElementById("liquid");
  if (u.drank >= u.prepaid) {
    liquid.style.fill = "var(--cup-empty)";
  } else {
    liquid.style.fill = "var(--cup-full)";
  }
}

// 7. POKLADNA
function renderFinance() {
  const vybrano = state.finance.vybrano || 0;
  const naklady = (state.finance.naklady || 0) + (state.finance.doprava || 0);
  const rozdil = vybrano - naklady;

  document.getElementById("fin-vybrano").textContent = `${vybrano} Kč`;
  document.getElementById("fin-naklady").textContent = `${naklady} Kč`;
  document.getElementById("fin-rozdil").textContent = `${rozdil} Kč`;
}

// 8. ODHLÁŠENÍ
document.getElementById("logout-btn").addEventListener("click", () => {
  state.currentUser = null;
  state.clicksInSession = 0;
  localStorage.removeItem("zus_saved_user");
  document.getElementById("login-pin").value = "";
  document.getElementById("admin-switch-btn").classList.add("hidden");
  document.getElementById("undo-btn").classList.add("hidden");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
});

// 9. ADMIN PANEL
document.getElementById("admin-switch-btn").addEventListener("click", () => {
  document.getElementById("main-view").classList.add("hidden");
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
      <td><button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="adminSaveUser(${u.id})">Uložit</button></td>
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

// Start aplikace
initTheme();
loadData();