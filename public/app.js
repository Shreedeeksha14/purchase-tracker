// app.js
// Frontend logic for the Purchase Tracker.
//
// Flow implemented:
//   1. Create a purchase (just a date) -> POST /api/purchases
//   2. Select that purchase, SELECT an item from the catalog dropdown,
//      enter a quantity, click "Add Item" -> POST /api/purchases/:id/items
//      (repeat step 2 as many times as needed for the same purchase)
//   3. All purchases + items are displayed in one table (via JOIN on
//      the backend), with Update / Delete per item row.

const API = '/api';

let itemTypes = [];  // [{id, type_name}]
let catalog = [];    // [{id, name, item_type_id, item_type_name, stock_quantity}]
let purchases = [];  // [{id, purchase_date}]  (dropdown source)

// ---- element refs ----------------------------------------------------

const purchaseForm = document.getElementById('purchase-form');
const newPurchaseDate = document.getElementById('new-purchase-date');
const purchaseFormError = document.getElementById('purchase-form-error');

const itemForm = document.getElementById('item-form');
const itemPurchaseSelect = document.getElementById('item-purchase-id');
const itemSelect = document.getElementById('item-select');
const itemStockHint = document.getElementById('item-stock-hint');
const itemTypeDisplay = document.getElementById('item-type-display');
const itemQuantityInput = document.getElementById('item-quantity');
const itemFormError = document.getElementById('item-form-error');

const dataTbody = document.getElementById('data-tbody');
const tableMessage = document.getElementById('table-message');

// ---- small helpers -----------------------------------------------------

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(box, message) {
  if (!message) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.textContent = message;
}

function showTableMessage(message, isError) {
  tableMessage.hidden = false;
  tableMessage.textContent = message;
  tableMessage.className = 'message-box ' + (isError ? 'message-error' : 'message-ok');
  setTimeout(() => { tableMessage.hidden = true; }, 3500);
}

async function api(path, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) {
        throw new Error((data && data.error) || 'Something went wrong. Please try again.');
      }
      return data;
    } catch (err) {
      // Network-level failure (e.g. the free hosted database timed out) —
      // retry a couple of times with a short pause before giving up.
      const isNetworkError = err instanceof TypeError; // "Failed to fetch"
      if (isNetworkError && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      throw err;
    }
  }
}

// ---- loading reference data ---------------------------------------------

async function loadItemTypes() {
  itemTypes = await api('/item-types');
}

async function loadCatalog() {
  catalog = await api('/items');
  itemSelect.innerHTML = '<option value="">Select item&hellip;</option>' +
    catalog.map((it) => {
      const disabled = it.stock_quantity === 0 ? 'disabled' : '';
      return `<option value="${it.id}" data-stock="${it.stock_quantity}" data-type="${escapeHtml(it.item_type_name)}" ${disabled}>
        ${escapeHtml(it.name)} (${it.stock_quantity} in stock)
      </option>`;
    }).join('');
}

async function loadPurchasesForDropdown() {
  const grouped = await api('/purchases');
  purchases = grouped.map((p) => ({ id: p.id, purchase_date: p.purchase_date }));
  itemPurchaseSelect.innerHTML = '<option value="">Select purchase&hellip;</option>' +
    purchases.map((p) => `<option value="${p.id}">Purchase ${p.id} (${formatDate(p.purchase_date)})</option>`).join('');
  return grouped;
}

// ---- Step 1: create a purchase --------------------------------------

purchaseForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(purchaseFormError, null);

  if (!newPurchaseDate.value) {
    showError(purchaseFormError, 'Purchase date is required.');
    return;
  }

  try {
    const created = await api('/purchases', {
      method: 'POST',
      body: JSON.stringify({ purchase_date: newPurchaseDate.value })
    });
    purchaseForm.reset();
    newPurchaseDate.value = todayISO();
    showTableMessage(`Purchase ${created.id} created. Now add items to it below.`, false);
    await refreshEverything();
    itemPurchaseSelect.value = created.id;
  } catch (err) {
    showError(purchaseFormError, err.message);
  }
});

// ---- Step 2: add an item (select + quantity) to a purchase -------------

itemSelect.addEventListener('change', () => {
  const opt = itemSelect.selectedOptions[0];
  if (opt && opt.value) {
    itemStockHint.textContent = `${opt.getAttribute('data-stock')} available`;
    itemTypeDisplay.textContent = opt.getAttribute('data-type');
  } else {
    itemStockHint.textContent = '';
    itemTypeDisplay.textContent = '—';
  }
});

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(itemFormError, null);

  // ---- basic frontend validation (backend re-validates everything) ----
  if (!itemPurchaseSelect.value) return showError(itemFormError, 'Please select a purchase first.');
  if (!itemSelect.value) return showError(itemFormError, 'Please select an item.');
  const qty = Number(itemQuantityInput.value);
  if (!itemQuantityInput.value || !Number.isInteger(qty) || qty <= 0) {
    return showError(itemFormError, 'Quantity must be a whole number greater than 0.');
  }

  try {
    await api(`/purchases/${itemPurchaseSelect.value}/items`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemSelect.value, quantity: qty })
    });
    const keepPurchaseId = itemPurchaseSelect.value;
    itemQuantityInput.value = '';
    itemSelect.value = '';
    itemStockHint.textContent = '';
    itemTypeDisplay.textContent = '—';
    showTableMessage('Item added to purchase.', false);
    await refreshEverything();
    itemPurchaseSelect.value = keepPurchaseId;
  } catch (err) {
    showError(itemFormError, err.message);
  }
});

// ---- Step 3: render the combined display table --------------------------

function renderTable(groupedPurchases) {
  const rows = [];
  for (const purchase of groupedPurchases) {
    if (purchase.items.length === 0) {
      rows.push(`
        <tr>
          <td>Purchase ${purchase.id}</td>
          <td colspan="7" class="empty-row">No items added to this purchase yet.</td>
        </tr>
      `);
      continue;
    }
    for (const item of purchase.items) {
      rows.push(`
        <tr data-purchase-item-id="${item.purchase_item_id}">
          <td>Purchase ${purchase.id}</td>
          <td>${item.item_id}</td>
          <td class="cell-name">${escapeHtml(item.item_name)}</td>
          <td>${escapeHtml(item.item_type_name)}</td>
          <td>${item.quantity}</td>
          <td class="${item.stock_remaining === 0 ? 'stock-zero' : ''}">${item.stock_remaining}</td>
          <td>${formatDate(purchase.purchase_date)}</td>
          <td class="col-actions">
            <button type="button" class="btn btn-small" data-edit="${item.purchase_item_id}">Update</button>
            <button type="button" class="btn btn-small btn-danger" data-delete="${item.purchase_item_id}">Delete</button>
          </td>
        </tr>
      `);
    }
  }

  dataTbody.innerHTML = rows.length
    ? rows.join('')
    : '<tr><td colspan="8" class="empty-row">No purchases yet.</td></tr>';
}

let lastGrouped = [];

dataTbody.addEventListener('click', async (e) => {
  const editId = e.target.getAttribute('data-edit');
  const deleteId = e.target.getAttribute('data-delete');

  if (editId) openEditRow(editId);
  if (deleteId) {
    if (!confirm('Delete this item? This will restore its stock.')) return;
    try {
      await api(`/purchase-items/${deleteId}`, { method: 'DELETE' });
      showTableMessage('Item deleted.', false);
      await refreshEverything();
    } catch (err) {
      showTableMessage(err.message, true);
    }
  }
});

function findItemRow(purchaseItemId) {
  for (const p of lastGrouped) {
    const found = p.items.find((i) => String(i.purchase_item_id) === String(purchaseItemId));
    if (found) return { purchase: p, item: found };
  }
  return null;
}

function openEditRow(purchaseItemId) {
  const found = findItemRow(purchaseItemId);
  if (!found) return;
  const { item } = found;

  const tr = dataTbody.querySelector(`tr[data-purchase-item-id="${purchaseItemId}"]`);
  if (!tr) return;

  const itemOptions = catalog.map((it) =>
    `<option value="${it.id}" ${Number(it.id) === Number(item.item_id) ? 'selected' : ''}>${escapeHtml(it.name)} (${it.stock_quantity + (Number(it.id) === Number(item.item_id) ? item.quantity : 0)} avail.)</option>`
  ).join('');

  const editTr = document.createElement('tr');
  editTr.className = 'edit-row';
  editTr.innerHTML = `
    <td colspan="8">
      <form class="edit-form">
        <label>Item
          <select class="edit-item-select">${itemOptions}</select>
        </label>
        <label>Quantity
          <input type="number" class="edit-qty-input" min="1" step="1" value="${item.quantity}" />
        </label>
        <button type="submit" class="btn btn-small btn-primary">Save</button>
        <button type="button" class="btn btn-small edit-cancel">Cancel</button>
        <div class="error-box edit-error" hidden></div>
      </form>
    </td>
  `;
  tr.replaceWith(editTr);

  editTr.querySelector('.edit-cancel').addEventListener('click', () => renderTable(lastGrouped));

  editTr.querySelector('.edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = editTr.querySelector('.edit-error');
    showError(errBox, null);

    const newItemId = editTr.querySelector('.edit-item-select').value;
    const newQty = Number(editTr.querySelector('.edit-qty-input').value);
    if (!newItemId) return showError(errBox, 'Please select an item.');
    if (!Number.isInteger(newQty) || newQty <= 0) return showError(errBox, 'Quantity must be a whole number greater than 0.');

    try {
      await api(`/purchase-items/${purchaseItemId}`, {
        method: 'PUT',
        body: JSON.stringify({ item_id: newItemId, quantity: newQty })
      });
      showTableMessage('Item updated.', false);
      await refreshEverything();
    } catch (err) {
      showError(errBox, err.message);
    }
  });
}

// ---- refresh everything from the server ---------------------------------

async function refreshEverything() {
  try {
    await loadCatalog();
    const grouped = await loadPurchasesForDropdown();
    lastGrouped = grouped;
    renderTable(grouped);
  } catch (err) {
    // One silent retry before bothering the user — covers a slow/flaky
    // connection to the hosted database on the very first attempt.
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await loadCatalog();
      const grouped = await loadPurchasesForDropdown();
      lastGrouped = grouped;
      renderTable(grouped);
    } catch (err2) {
      showTableMessage(err2.message, true);
    }
  }
}

// ---- init ----------------------------------------------------------------

async function init() {
  newPurchaseDate.value = todayISO();
  try {
    await loadItemTypes();
    await refreshEverything();
  } catch (err) {
    showTableMessage('Unable to load data from the server.', true);
    console.error(err);
  }
}

init();