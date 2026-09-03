// URL vašeho Google Apps Script Web App
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwEDpLlUikYhMCJlolZZOgwqI8Gb_gMOYLwE4FDUtgD7hMIcHFGywGMwVG4pNNLRLU5CA/exec";

let state = {
  users: [],
  finance: {},
  currentUser: null
};

// Registrace Service Workeru pro PWA instalaci
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW reg failed: ', err));
  });
}

// Načtení dat při startu
async function loadData() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=getData`);
    const data = await res.json();
    state.users = data.users;
    state.finance = data.finance;
    populateUserSelect();
    renderFinance();
  } catch (err) {
    console.error("Chyba při stahování dat:", err);
  }
}

function populateUserSelect() {
  const select = document.getElementById("user-select");
  select.innerHTML = '<option value="" disabled selected>Vyber své jméno...</option>';
  state.users.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.id;
    opt.textContent = u.name;
    select.appendChild(opt);
  });
}

function renderFinance() {
  const nakladyCelkem = (state.finance.naklady || 0) + (state.finance.doprava || 0);
  const zustatek = (state.finance.vybrano || 0) - nakladyCelkem;

  document.getElementById("fin-vybrano").textContent = `${state.finance.vybrano || 0} Kč`;
  document.getElementById("fin-vydaje").textContent = `${nakladyCelkem} Kč`;
  
  const rozdilEl = document.getElementById("fin-rozdil");
  rozdilEl.textContent = `${zustatek} Kč`;
  rozdilEl.style.color = zustatek >= 0 ? "#bbf7d0" : "#fca5a5";
}

// Přihlášení
document.getElementById("login-btn").addEventListener("click", () => {
  const userId = document.getElementById("user-select").value;
  const pin = document.getElementById("user-pin").value;

  const user = state.users.find(u => u.id == userId && u.pin === pin);
  if (user) {
    state.currentUser = user;
    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("main-view").classList.remove("hidden");
    
    if (user.role === "admin") {
      document.getElementById("admin-switch-btn").classList.remove("hidden");
    }
    updateUserCard();
  } else {
    alert("Nesprávný PIN nebo nevybrané jméno.");
  }
});

// Vykreslení stavu uživatele
function updateUserCard() {
  const u = state.currentUser;
  document.getElementById("cup-counts").textContent = `${u.drank} / ${u.prepaid}`;
  
  const liquid = document.getElementById("liquid");
  const crema = document.getElementById("crema-ring");
  const hint = document.getElementById("cup-action-text");

  if (u.drank >= u.prepaid) {
    liquid.setAttribute("fill", "#e8d8c8"); // Prázdný / suchý šálek
    crema.style.display = "none";
    hint.textContent = "Vyčerpáno! Chce to nové předplatné.";
  } else {
    liquid.setAttribute("fill", "#442617"); // Plná káva
    crema.style.display = "block";
    hint.textContent = "Klepnutím na šálek odečteš kávu ☕";
  }
}

// Kliknutí na šálek – vypití kávy
document.getElementById("coffee-cup").addEventListener("click", async () => {
  const u = state.currentUser;
  if (!u) return;

  if (u.drank >= u.prepaid) {
    alert("Máš vyčerpaných všech 20 káv. Zadej adminovi platbu na další měsíc.");
    return;
  }

  // Okamžitá UI odezva
  u.drank += 1;
  updateUserCard();

  // Odeslání do Google Tabulky na pozadí
  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "drinkCoffee", id: u.id })
    });
  } catch (err) {
    console.error("Zápis se nezdařil:", err);
  }
});

// Admin panel zobrazení
document.getElementById("admin-switch-btn").addEventListener("click", () => {
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.remove("hidden");
  renderAdminTable();
});

document.getElementById("admin-back-btn").addEventListener("click", () => {
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
});

function renderAdminTable() {
  const tbody = document.getElementById("admin-user-list");
  tbody.innerHTML = "";
  
  state.users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.name}</td>
      <td><input type="number" id="p-${u.id}" value="${u.prepaid}"></td>
      <td><input type="number" id="d-${u.id}" value="${u.drank}"></td>
      <td><button class="btn" style="padding:4px 8px; font-size:0.75rem;" onclick="saveUser(${u.id})">Uložit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.saveUser = async function(id) {
  const prep = Number(document.getElementById(`p-${id}`).value);
  const drk = Number(document.getElementById(`d-${id}`).value);

  const u = state.users.find(x => x.id == id);
  u.prepaid = prep;
  u.drank = drk;

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminUpdate", id: id, prepaid: prep, drank: drk })
  });
  alert(`Uloženo pro ${u.name}`);
};

// Odhlášení
document.getElementById("logout-btn").addEventListener("click", () => {
  state.currentUser = null;
  document.getElementById("user-pin").value = "";
  document.getElementById("admin-switch-btn").classList.add("hidden");
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("admin-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
});

// Spuštění
loadData();