(() => {
  const API_BASE = '/api';

  const itemRowsEl = document.getElementById('item-rows');
  const addRowBtn = document.getElementById('add-row-btn');
  const formErrorsEl = document.getElementById('form-errors');
  const purchaseForm = document.getElementById('purchase-form');
  const rowTemplate = document.getElementById('item-row-template');

  const itemsTbody = document.getElementById('items-tbody');
  const itemCountEl = document.getElementById('item-count');
  const ledgerMessageEl = document.getElementById('ledger-message');

  let itemTypes = []; // [{id, type_name}]
  let items = [];      // current ledger rows from the server
  let editingId = null; // id of the item row currently being edited inline

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------

  async function init() {
    await loadItemTypes();
    addItemRow(); // start the form with one row
    await loadItems();
    addRowBtn.addEventListener('click', () => addItemRow());
    purchaseForm.addEventListener('submit', handleSubmit);
  }

  // ---------------------------------------------------------------
  // Item types (for the dropdown)
  // ---------------------------------------------------------------

  async function loadItemTypes() {
    try {
      const res = await fetch(`${API_BASE}/item-types`);
      itemTypes = await res.json();
    } catch (err) {
      console.error('Failed to load item types', err);
      itemTypes = [];
    }
  }

  function populateTypeSelect(select) {
    // keep the placeholder, drop any old options, then repopulate
    select.innerHTML = '<option value="">Select&hellip;</option>';
    itemTypes.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.type_name;
      select.appendChild(opt);
    });
  }

  // ---------------------------------------------------------------
  // Dynamic intake rows ("one purchase, many items")
  // ---------------------------------------------------------------

  function addItemRow() {
    const fragment = rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('[data-row]');
    const select = row.querySelector('select[name="item_type_id"]');
    populateTypeSelect(select);

    row.querySelector('.row-remove').addEventListener('click', () => {
      // never leave the form with zero rows
      if (itemRowsEl.querySelectorAll('[data-row]').length > 1) {
        row.remove();
      }
    });

    itemRowsEl.appendChild(row);
  }

  function collectFormRows() {
    return Array.from(itemRowsEl.querySelectorAll('[data-row]')).map((row) => ({
      name: row.querySelector('input[name="name"]').value.trim(),
      item_type_id: row.querySelector('select[name="item_type_id"]').value,
      purchase_date: row.querySelector('input[name="purchase_date"]').value,
      stock_available: row.querySelector('input[name="stock_available"]').checked
    }));
  }

  function showFormErrors(messages) {
    if (!messages || messages.length === 0) {
      formErrorsEl.hidden = true;
      formErrorsEl.innerHTML = '';
      return;
    }
    formErrorsEl.hidden = false;
    formErrorsEl.innerHTML = `<strong>Please fix the following:</strong><ul>${messages
      .map((m) => `<li>${escapeHtml(m)}</li>`)
      .join('')}</ul>`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    showFormErrors(null);

    const rows = collectFormRows();

    // light client-side pass (backend re-validates authoritatively)
    const clientErrors = [];
    rows.forEach((r, i) => {
      const prefix = rows.length > 1 ? `Item ${i + 1}: ` : '';
      if (!r.name) clientErrors.push(`${prefix}Item Name is required`);
      if (!r.item_type_id) clientErrors.push(`${prefix}Item Type is required`);
      if (!r.purchase_date) clientErrors.push(`${prefix}Purchase Date is required`);
    });
    if (clientErrors.length > 0) {
      showFormErrors(clientErrors);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: rows })
      });
      const data = await res.json();

      if (!res.ok) {
        showFormErrors(data.details || [data.error || 'Something went wrong']);
        return;
      }

      // reset the form back to a single blank row
      itemRowsEl.innerHTML = '';
      addItemRow();
      showLedgerMessage(data.message || 'Purchase logged', false);
      await loadItems();
    } catch (err) {
      console.error('Submit failed', err);
      showFormErrors(['Could not reach the server. Please try again.']);
    }
  }

  // ---------------------------------------------------------------
  // Ledger table
  // ---------------------------------------------------------------

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/items`);
      items = await res.json();
      renderTable();
    } catch (err) {
      console.error('Failed to load items', err);
      showLedgerMessage('Could not load the item ledger.', true);
    }
  }

  function renderTable() {
    itemCountEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
      itemsTbody.innerHTML = `<tr class="empty-row"><td colspan="5">No items logged yet &mdash; add your first purchase above.</td></tr>`;
      return;
    }

    itemsTbody.innerHTML = '';
    items.forEach((item) => {
      const tr = item.id === editingId ? buildEditRow(item) : buildDisplayRow(item);
      itemsTbody.appendChild(tr);
    });
  }

  function buildDisplayRow(item) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-name">${escapeHtml(item.name)}</td>
      <td><span class="type-pill">${escapeHtml(item.item_type_name)}</span></td>
      <td class="col-date">${escapeHtml(item.purchase_date)}</td>
      <td>${item.stock_available ? '<span class="stamp stamp--yes">In Stock</span>' : '<span class="stamp stamp--no">Out of Stock</span>'}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit" data-id="${item.id}">Edit</button>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </td>
    `;
    tr.querySelector('[data-action="edit"]').addEventListener('click', () => {
      editingId = item.id;
      renderTable();
    });
    tr.querySelector('[data-action="delete"]').addEventListener('click', () => handleDelete(item));
    return tr;
  }

  function buildEditRow(item) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" name="name" maxlength="150" value="${escapeAttr(item.name)}" /></td>
      <td><select name="item_type_id"></select></td>
      <td><input type="date" name="purchase_date" value="${escapeAttr(item.purchase_date)}" /></td>
      <td><label class="checkbox-label"><input type="checkbox" name="stock_available" ${item.stock_available ? 'checked' : ''} /> In stock</label></td>
      <td>
        <div class="row-actions">
          <button type="button" class="icon-btn icon-btn--save" data-action="save">Save</button>
          <button type="button" class="icon-btn" data-action="cancel">Cancel</button>
        </div>
      </td>
    `;
    const select = tr.querySelector('select[name="item_type_id"]');
    populateTypeSelect(select);
    select.value = item.item_type_id;

    tr.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      editingId = null;
      renderTable();
    });
    tr.querySelector('[data-action="save"]').addEventListener('click', () => handleSave(item, tr));
    return tr;
  }

  async function handleSave(item, tr) {
    const payload = {
      name: tr.querySelector('input[name="name"]').value.trim(),
      item_type_id: tr.querySelector('select[name="item_type_id"]').value,
      purchase_date: tr.querySelector('input[name="purchase_date"]').value,
      stock_available: tr.querySelector('input[name="stock_available"]').checked
    };

    if (!payload.name || !payload.item_type_id || !payload.purchase_date) {
      showLedgerMessage('All fields are required to save a change.', true);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        showLedgerMessage((data.details && data.details.join(' ')) || data.error || 'Update failed', true);
        return;
      }

      editingId = null;
      showLedgerMessage('Item updated.', false);
      await loadItems();
    } catch (err) {
      console.error('Update failed', err);
      showLedgerMessage('Could not reach the server to save changes.', true);
    }
  }

  async function handleDelete(item) {
    const confirmed = window.confirm(`Delete "${item.name}" from the ledger? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/items/${item.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        showLedgerMessage(data.error || 'Delete failed', true);
        return;
      }

      showLedgerMessage('Item deleted.', false);
      await loadItems();
    } catch (err) {
      console.error('Delete failed', err);
      showLedgerMessage('Could not reach the server to delete this item.', true);
    }
  }

  function showLedgerMessage(text, isError) {
    ledgerMessageEl.hidden = false;
    ledgerMessageEl.textContent = text;
    ledgerMessageEl.classList.toggle('is-error', !!isError);
    window.clearTimeout(showLedgerMessage._t);
    showLedgerMessage._t = window.setTimeout(() => {
      ledgerMessageEl.hidden = true;
    }, 4000);
  }

  // ---------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  init();
})();
