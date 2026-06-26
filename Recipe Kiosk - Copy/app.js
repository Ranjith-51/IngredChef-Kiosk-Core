// --- CENTRAL WEB ENVIRONMENT SUPABASE API KEY REGISTRATION ---
const SUPABASE_PROJECT_URL = "https://fnbvyrkrgltcvpzmnxoo.supabase.co/rest/v1/"; // Replace with your URL
const SUPABASE_PUBLIC_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuYnZ5cmtyZ2x0Y3Zwem1ueG9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NTY2MDksImV4cCI6MjA5ODAzMjYwOX0.fBGX_hu2PzPrsf50B7JiHgjJhWe8-Mviu08DVrhugAE"; // Replace with your Key
const dbClient = supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLIC_ANON);

// Application Memory Global State Metrics
let cart = [];
let activeCustomer = null;
let foodCourtStalls = [];
let orderHistory = [];
let globalCachedOrders = [];
let activeUserSession = JSON.parse(sessionStorage.getItem('activeHubUser')) || null;

document.addEventListener('DOMContentLoaded', async () => {
    // 🚦 SPA VIEW ROUTER ROUTER INITS 🚦
    document.getElementById('gate-to-customer-btn').addEventListener('click', launchCustomerWorkspaceView);
    document.getElementById('gate-to-kitchen-btn').addEventListener('click', triggerKitchenGatewayAuthModal);
    document.getElementById('auth-cancel-btn').addEventListener('click', () => document.getElementById('kds-auth-screen').classList.add('hidden'));
    document.getElementById('auth-login-btn').addEventListener('click', processKdsSecurityAccessCheck);

    // Kiosk Setup Bindings
    document.getElementById('register-cust-btn').addEventListener('click', saveCustomerSessionProfile);
    document.getElementById('search-btn').addEventListener('click', pullMealsFromWebDatabase);
    document.getElementById('checkout-btn').addEventListener('click', transmitCompletedBillToCloud);
    document.getElementById('clear-kiosk-btn').addEventListener('click', () => { cart = []; activeCustomer = null; location.reload(); });
    document.getElementById('close-modal-btn').addEventListener('click', () => document.getElementById('recipe-modal').classList.add('hidden'));

    // Kitchen Setup Bindings
    document.getElementById('hub-logout-btn').addEventListener('click', terminateKitchenHubSession);
    document.getElementById('commit-add-stall-btn').addEventListener('click', registerNewVendorStall);
    document.getElementById('admin-wipe-logs-btn').addEventListener('click', adminClearGlobalDataLog);
    document.getElementById('stall-selector').addEventListener('change', () => renderKDSTicketsGrid());

    document.querySelectorAll('.category-card').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('food-search-input').value = btn.getAttribute('data-category');
            pullMealsFromWebDatabase();
        });
    });

    // Handle session persistence on page refresh
    await fetchOperationalStallData();
    if (activeUserSession) {
        document.getElementById('view-gateway').classList.add('hidden');
        document.getElementById('view-kitchen-hub').classList.remove('hidden');
        await establishKitchenRealtimeSocketPipe();
        evaluateSessionUI();
    }
});

function returnToMainGateway() {
    document.getElementById('view-customer-kiosk').classList.add('hidden');
    document.getElementById('view-kitchen-hub').classList.add('hidden');
    document.getElementById('view-gateway').classList.remove('hidden');
}

// ==========================================
// 🛒 SECTION A: CUSTOMER WORKSPACE CODE
// ==========================================
async function launchCustomerWorkspaceView() {
    document.getElementById('view-gateway').classList.add('hidden');
    document.getElementById('view-customer-kiosk').classList.remove('hidden');
    
    let { data } = await dbClient.from('orders').select('*').order('epochIssued', { ascending: false }).limit(15);
    orderHistory = data || [];
    updateHistoryDashboardUI();

    dbClient.channel('kiosk-view-sync').on('postgres_changes', { event: '*', table: 'orders' }, payload => {
        if (payload.eventType === 'INSERT') orderHistory.unshift(payload.new);
        if (payload.eventType === 'UPDATE') {
            const idx = orderHistory.findIndex(o => o.orderId === payload.new.orderId);
            if (idx !== -1) orderHistory[idx] = payload.new;
        }
        updateHistoryDashboardUI();
    }).subscribe();
}

function saveCustomerSessionProfile() {
    const name = document.getElementById('cust-name-input').value.trim();
    const phone = document.getElementById('cust-phone-input').value.trim();
    if (!name || phone.length !== 10 || isNaN(phone)) return alert("Input a valid name and a 10-digit mobile number.");
    
    activeCustomer = { name, phone };
    document.getElementById('cust-name-input').disabled = true;
    document.getElementById('cust-phone-input').disabled = true;
    document.getElementById('register-cust-btn').disabled = true;
    
    const banner = document.getElementById('session-status-text');
    banner.innerHTML = `✅ Linked Profile Session: <strong>${name} (${phone})</strong>`;
    banner.style.background = "#e8f8f5"; banner.style.color = "#2ecc71";
}

async function pullMealsFromWebDatabase() {
    const term = document.getElementById('food-search-input').value.trim();
    if (!term) return;
    const msg = document.getElementById('status-message');
    msg.textContent = `🔍 Querying items catalog matching "${term}"...`;
    
    try {
        let res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term)}`);
        let data = await res.json();
        if (!data.meals) {
            res = await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?c=${encodeURIComponent(term)}`);
            data = await res.json();
        }
        if (!data.meals) return msg.textContent = "❌ Zero matches located. Try alternative categories.";
        msg.textContent = ` Loaded listings for "${term}":`;
        displayMealCardsUI(data.meals);
    } catch { msg.textContent = "⚠️ Cloud Catalog sync error."; }
}

function displayMealCardsUI(meals) {
    const grid = document.getElementById('recipe-grid'); grid.innerHTML = '';
    meals.forEach((meal, i) => {
        const title = meal.strMeal; const img = meal.strMealThumb; const id = meal.idMeal || "52771";
        const cost = Math.max(120, Math.min(((parseInt(id) % 300) + 140), 650));
        const stall = foodCourtStalls[Math.abs(title.charCodeAt(0) + i) % foodCourtStalls.length] || "Global Counter";

        const card = document.createElement('div'); card.className = "meal-card";
        card.innerHTML = `
            <img src="${img}" style="width:100%; height:150px; object-fit:cover;">
            <div style="padding:15px; display:flex; flex-direction:column; flex:1; justify-content:space-between;">
                <div><span class="stall-tag">${stall}</span><h4 style="margin:5px 0; font-size:0.95rem;">${title}</h4></div>
                <div><p style="font-weight:900; margin:5px 0;">₹${cost}</p><button class="select-btn">Select Item</button></div>
            </div>`;
        card.querySelector('.select-btn').onclick = () => triggerCustomizationModal(title, cost, stall, img);
        grid.appendChild(card);
    });
}

function triggerCustomizationModal(title, cost, stall, img) {
    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <div style="display:flex; gap:20px; flex-wrap:wrap;">
            <img src="${img}" style="width:180px; height:180px; object-fit:cover; border-radius:8px;">
            <div style="flex:1; min-width:220px;">
                <h3 style="margin:0 0 5px 0;">${title}</h3>
                <p style="color:#7f8c8d; font-size:0.85rem; margin:0 0 10px 0;">Outlet Node: ${stall}</p>
                <div style="margin-bottom:12px;">
                    <label style="font-weight:bold; display:block; margin-bottom:4px;">Size Variant:</label>
                    <input type="radio" name="msize" value="Reg" checked> Regular Pack <br>
                    <input type="radio" name="msize" value="Lrg"> Jumbo Pack (+₹60)
                </div>
                <div style="margin-bottom:12px;">
                    <label style="font-weight:bold; display:block; margin-bottom:4px;">Custom Addons:</label>
                    <input type="checkbox" id="mcheese" value="Cheese"> Layered Cheddar Cheese (+₹40)
                </div>
                <p style="font-size:1.2rem; font-weight:900; color:#e74c3c; margin:10px 0;">Base Rate: ₹${cost}</p>
                <button id="add-to-basket-btn" style="background:#2ecc71; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; width:100%; cursor:pointer;">Confirm Addition</button>
            </div>
        </div>`;
    document.getElementById('recipe-modal').classList.remove('hidden');
    document.getElementById('add-to-basket-btn').onclick = () => {
        const isLrg = document.querySelector('input[name="msize"]:checked').value === "Lrg";
        const addsChz = document.getElementById('mcheese').checked;
        let finalCost = cost; let tags = [];
        if (isLrg) { finalCost += 60; tags.push("Jumbo Size"); }
        if (addsChz) { finalCost += 40; tags.push("Extra Cheese"); }

        cart.push({ id: Date.now() + Math.random().toString(36).substring(2,4), name: title, unitPrice: finalCost, quantity: 1, stallName: stall, customizations: tags });
        document.getElementById('recipe-modal').classList.add('hidden');
        renderBasketUI();
    };
}

function renderBasketUI() {
    const box = document.getElementById('cart-items-container'); box.innerHTML = '';
    if (cart.length === 0) return box.innerHTML = '<div style="color:#7f8c8d; text-align:center; padding:20px 0;">Basket Empty.</div>';
    let sum = 0;
    cart.forEach(c => {
        sum += c.unitPrice;
        const div = document.createElement('div'); div.className = "basket-item-row";
        div.innerHTML = `<div><strong>${c.name}</strong><br><small>${c.stallName}</small> ${c.customizations.length?`<br><small style="color:#e67e22;">➔ ${c.customizations.join(', ')}</small>`:''}</div>
                         <div>₹${c.unitPrice} <button style="color:#e74c3c; background:none; border:none; font-weight:bold; cursor:pointer; margin-left:10px;">&times;</button></div>`;
        div.querySelector('button').onclick = () => { cart = cart.filter(i => i.id !== c.id); renderBasketUI(); };
        box.appendChild(div);
    });
    document.getElementById('cart-grand-total').textContent = `₹${sum}`;
}

async function transmitCompletedBillToCloud() {
    if (!activeCustomer) return alert("Register profile data prior to checking out.");
    if (cart.length === 0) return alert("Basket Empty.");

    const orderId = "ORD-" + Math.floor(100000 + Math.random() * 900000);
    const token = Math.floor(10 + Math.random() * 89);
    const splitStalls = {}; let total = 0;
    
    cart.forEach(c => {
        total += c.unitPrice;
        if (!splitStalls[c.stallName]) splitStalls[c.stallName] = [];
        splitStalls[c.stallName].push({ name: c.name, qty: c.quantity, customizations: c.customizations });
    });

    const segments = Object.keys(splitStalls).map(k => ({ stallName: k, items: splitStalls[k], etaMinutes: null, dismissed: false }));
    const payload = { orderId, tokenNumber: token, customerName: activeCustomer.name, customerPhone: activeCustomer.phone, epochIssued: Date.now(), stalls: segments, grandTotal: total };

    const { error } = await dbClient.from('orders').insert([payload]);
    if (!error) {
        triggerReceiptUI(payload); cart = []; renderBasketUI();
    } else alert("Cloud network sync error.");
}

function triggerReceiptUI(order) {
    const body = document.getElementById('invoice-body');
    body.innerHTML = `<div style="text-align:center;"><h1 style="color:#2ecc71; margin:0; font-size:2.8rem;"># ${order.tokenNumber}</h1><p style="color:#7f8c8d; font-size:0.8rem; margin-top:0;">ORDER DISPATCH QUEUE TOKEN</p></div>
                     <p style="font-size:0.85rem;"><strong>ID:</strong> ${order.orderId}<br><strong>Client:</strong> ${order.customerName}</p>
                     <h5 style="margin:10px 0 5px 0;">Distribution Routings:</h5>
                     <ul style="padding-left:15px; margin:0; font-size:0.8rem;">${order.stalls.map(s => `<li><strong>${s.stallName}</strong> (${s.items.length} items)</li>`).join('')}</ul>
                     <h3 style="text-align:right; margin:15px 0 0 0;">Charged: ₹${order.grandTotal}</h3>`;
    document.getElementById('invoice-modal').classList.remove('hidden');
}

function updateHistoryDashboardUI() {
    const body = document.getElementById('history-log-table-body'); body.innerHTML = '';
    if (!orderHistory.length) body.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:10px; color:#7f8c8d;">No historical tokens.</td></tr>';
    orderHistory.slice(0,8).forEach(o => {
        const row = document.createElement('tr'); row.style.borderBottom = "1px solid #eee";
        row.innerHTML = `<td style="padding:5px;">${new Date(o.epochIssued).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
                         <td style="padding:5px; font-weight:bold; color:#e67e22;">#${o.tokenNumber}</td>
                         <td style="padding:5px; font-weight:bold;">₹${o.grandTotal}</td>`;
        body.appendChild(row);
    });
}

// ==========================================
// 🍳 SECTION B: KITCHEN OPERATIONS CORE CODE
// ==========================================
function triggerKitchenGatewayAuthModal() {
    document.getElementById('kds-auth-screen').classList.remove('hidden');
}

async function fetchOperationalStallData() {
    let { data } = await dbClient.from('stalls').select('*');
    if (!data || data.length === 0) {
        const structuralSeeds = [
            { name: "Wok & Roll Asian Kitchen", secret: "wok123" },
            { name: "Bella Italia Pasta Counter", secret: "pasta123" },
            { name: "The Spud Shack & Grill", secret: "spud123" }
        ];
        await dbClient.from('stalls').insert(structuralSeeds);
        data = structuralSeeds;
    }
    window.cachedStalls = data;
    foodCourtStalls = data.map(s => s.name);
    const select = document.getElementById('stall-selector');
    if (select) select.innerHTML = '<option value="ALL">-- ALL SYSTEMS ONLINE --</option>' + data.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

function processKdsSecurityAccessCheck() {
    const user = document.getElementById('auth-username').value.trim();
    const pass = document.getElementById('auth-password').value.trim();

    if (user.toLowerCase() === 'admin' && pass === 'admin779') {
        activeUserSession = { username: "System Admin", role: "admin" };
        sessionStorage.setItem('activeHubUser', JSON.stringify(activeUserSession));
        return location.reload();
    }
    const match = (window.cachedStalls || []).find(s => s.name.toLowerCase() === user.toLowerCase() && s.secret === pass);
    if (match) {
        activeUserSession = { username: match.name, role: "stall" };
        sessionStorage.setItem('activeHubUser', JSON.stringify(activeUserSession));
        location.reload();
    } else {
        document.getElementById('auth-error-msg').textContent = "Security clearance rejected.";
    }
}

async function establishKitchenRealtimeSocketPipe() {
    let { data } = await dbClient.from('orders').select('*').order('epochIssued', { ascending: false });
    globalCachedOrders = data || [];

    dbClient.channel('kds-stream-sync').on('postgres_changes', { event: '*', table: 'orders' }, payload => {
        if (payload.eventType === 'INSERT') globalCachedOrders.unshift(payload.new);
        if (payload.eventType === 'UPDATE') {
            const idx = globalCachedOrders.findIndex(o => o.orderId === payload.new.orderId);
            if (idx !== -1) globalCachedOrders[idx] = payload.new;
        }
        if (payload.eventType === 'DELETE') globalCachedOrders = globalCachedOrders.filter(o => o.orderId !== payload.old.orderId);
        renderKDSTicketsGrid();
        if (activeUserSession?.role === 'admin') renderAdminHistoryTableUI();
    }).subscribe();
}

function evaluateSessionUI() {
    document.getElementById('kds-auth-screen').add;
    document.getElementById('active-session-identity').textContent = `👤 Logged: ${activeUserSession.username.toUpperCase()}`;

    if (activeUserSession.role === 'admin') {
        document.getElementById('central-admin-view').classList.remove('hidden');
        renderAdminVendorListUI(); renderAdminHistoryTableUI();
    } else {
        document.getElementById('stall-selector').value = activeUserSession.username;
        document.getElementById('stall-selector').disabled = true;
    }
    renderKDSTicketsGrid();
}

function renderKDSTicketsGrid() {
    const filter = activeUserSession.role === 'admin' ? document.getElementById('stall-selector').value : activeUserSession.username;
    const pBox = document.getElementById('queue-pending'); const rBox = document.getElementById('queue-ready');
    pBox.innerHTML = ''; rBox.innerHTML = ''; let pC = 0, rC = 0;

    globalCachedOrders.forEach(order => {
        order.stalls.forEach(s => {
            if (filter !== "ALL" && s.stallName !== filter) return;
            if (s.dismissed) return;
            const isDone = s.etaMinutes !== null;
            
            const card = document.createElement('div'); card.className = "kds-ticket";
            card.style.borderLeft = `5px solid ${isDone?'#2ecc71':'#f1c40f'}`;
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#7f8c8d;"><strong>${order.orderId}</strong> <span>${new Date(order.epochIssued).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></div>
                <small style="color:#7f8c8d; font-weight:bold;">🏪 ${s.stallName}</small><h4 style="margin:5px 0;">👤 ${order.customerName}</h4>
                <div style="background:#2c3e50; color:white; padding:3px 6px; border-radius:4px; font-weight:900; width:fit-content; margin:5px 0;">TOKEN #${order.tokenNumber}</div>
                <ul style="padding-left:15px; margin:5px 0; font-size:0.85rem;">${s.items.map(i => `<li><strong>${i.qty}x</strong> ${i.name} ${i.customizations.length?`<br><small style="color:#e67e22;">➔ ${i.customizations.join(', ')}</small>`:''}</li>`).join('')}</ul>
                <button style="background:${isDone?'#95a5a6':'#2ecc71'}; color:white; border:none; width:100%; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:8px;">${isDone?'Clear Board':'Mark Completed'}</button>`;
            
            card.querySelector('button').onclick = async () => {
                const updated = order.stalls.map(st => {
                    if (st.stallName === s.stallName) { if (!isDone) st.etaMinutes = 0; else st.dismissed = true; }
                    return st;
                });
                await dbClient.from('orders').update({ stalls: updated }).eq('orderId', order.orderId);
            };
            if (isDone) { rBox.appendChild(card); rC++; } else { pBox.appendChild(card); pC++; }
        });
    });
    document.getElementById('count-pending').textContent = pC; document.getElementById('count-ready').textContent = rC;
}

function renderAdminVendorListUI() {
    const container = document.getElementById('admin-vendor-list'); container.innerHTML = '';
    (window.cachedStalls || []).forEach(s => {
        const div = document.createElement('div'); div.className = "vendor-row";
        div.innerHTML = `<span>🏪 ${s.name}</span> <button class="vendor-del-btn">Revoke</button>`;
        div.querySelector('button').onclick = async () => {
            if (confirm(`Revoke license for ${s.name}?`)) {
                await dbClient.from('stalls').delete().eq('name', s.name);
                await fetchOperationalStallData(); renderAdminVendorListUI();
            }
        };
        container.appendChild(div);
    });
}

function renderAdminHistoryTableUI() {
    const table = document.getElementById('admin-global-history-body'); table.innerHTML = '';
    globalCachedOrders.forEach(o => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="padding:8px;">${new Date(o.epochIssued).toLocaleTimeString()}</td>
                        <td style="padding:8px;"><code>${o.orderId}</code><br><strong>Token #${o.tokenNumber}</strong></td>
                        <td style="padding:8px;"><strong>${o.customerName}</strong></td>
                        <td style="padding:8px; font-size:0.75rem;">${o.stalls.map(s=>`• ${s.stallName} (${s.etaMinutes===null?'Cooking':'Ready'})`).join('<br>')}</td>
                        <td style="padding:8px; font-weight:bold;">₹${o.grandTotal}</td>`;
        table.appendChild(tr);
    });
}

async function registerNewVendorStall() {
    const name = document.getElementById('new-stall-name').value.trim();
    const secret = document.getElementById('new-stall-password').value.trim();
    if (!name || !secret) return alert("Fill credentials completely.");
    await dbClient.from('stalls').insert([{ name, secret }]);
    document.getElementById('new-stall-name').value = ''; document.getElementById('new-stall-password').value = '';
    await fetchOperationalStallData(); renderAdminVendorListUI();
}

async function adminClearGlobalDataLog() {
    if (confirm("Permanently purge transactional operations history records?")) {
        await dbClient.from('orders').delete().neq('orderId', 'WIPE_CMD');
        globalCachedOrders = []; renderKDSTicketsGrid(); renderAdminHistoryTableUI();
    }
}

function terminateKitchenHubSession() { sessionStorage.removeItem('activeHubUser'); location.reload(); }