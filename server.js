// server.js
// Express + MySQL backend for the Purchase Tracker app.
//
// Key design decision (per reviewer feedback on the earlier version):
//   - A user does NOT type a brand-new item name for every purchase.
//   - A user SELECTS an existing item from the catalog (the `items`
//     table) and enters a QUANTITY to purchase.
//   - There is no "in stock / not in stock" checkbox. Stock is a real
//     number (`items.stock_quantity`). The backend validates the
//     requested quantity against it before saving, and reduces stock
//     when a purchase item is added.

const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// Small validation helpers
// ------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  return !Number.isNaN(new Date(s).getTime());
}

/** Validates the { item_id, quantity } payload used to add/update a purchase line. */
function validatePurchaseItemInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['Invalid request'];

  if (body.item_id === undefined || body.item_id === null || body.item_id === '' || Number.isNaN(Number(body.item_id))) {
    errors.push('Please select an item.');
  }

  const qty = Number(body.quantity);
  if (body.quantity === undefined || body.quantity === null || body.quantity === '' || Number.isNaN(qty)) {
    errors.push('Quantity is required.');
  } else if (!Number.isInteger(qty) || qty <= 0) {
    errors.push('Quantity must be a whole number greater than 0.');
  }

  return errors;
}

// ------------------------------------------------------------------
// Item Types  (GET /api/item-types)
// ------------------------------------------------------------------

app.get('/api/item-types', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, type_name FROM item_types ORDER BY type_name ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load item types. Please try again.' });
  }
});

// ------------------------------------------------------------------
// Item Catalog  (GET/POST /api/items, PUT/DELETE /api/items/:id)
// This is the list of items a user can SELECT when adding to a purchase.
// ------------------------------------------------------------------

const CATALOG_JOIN = `
  SELECT items.id, items.name, items.stock_quantity, items.item_type_id,
         item_types.type_name AS item_type_name
  FROM items
  JOIN item_types ON items.item_type_id = item_types.id
`;

app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await pool.query(`${CATALOG_JOIN} ORDER BY items.name ASC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load items. Please try again.' });
  }
});

app.post('/api/items', async (req, res) => {
  const { name, item_type_id, stock_quantity } = req.body || {};
  const errors = [];

  if (!name || typeof name !== 'string' || !name.trim()) {
    errors.push('Item name is required.');
  }
  if (item_type_id === undefined || item_type_id === null || item_type_id === '' || Number.isNaN(Number(item_type_id))) {
    errors.push('Please select an item type.');
  }
  if (
    stock_quantity === undefined || stock_quantity === null || stock_quantity === '' ||
    Number.isNaN(Number(stock_quantity)) || Number(stock_quantity) < 0 || !Number.isInteger(Number(stock_quantity))
  ) {
    errors.push('Stock quantity is required and must be 0 or more.');
  }

  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });

  try {
    const [typeRows] = await pool.query('SELECT id FROM item_types WHERE id = ?', [Number(item_type_id)]);
    if (typeRows.length === 0) return res.status(400).json({ error: 'Please select a valid item type.' });

    const [result] = await pool.query(
      'INSERT INTO items (name, item_type_id, stock_quantity) VALUES (?, ?, ?)',
      [name.trim(), Number(item_type_id), Number(stock_quantity)]
    );
    const [rows] = await pool.query(`${CATALOG_JOIN} WHERE items.id = ?`, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to save item. Please try again.' });
  }
});

app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const { name, item_type_id, stock_quantity } = req.body || {};
  if (Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid item id.' });

  const errors = [];
  if (!name || !String(name).trim()) errors.push('Item name is required.');
  if (item_type_id === undefined || item_type_id === null || item_type_id === '' || Number.isNaN(Number(item_type_id))) {
    errors.push('Please select an item type.');
  }
  if (
    stock_quantity === undefined || stock_quantity === null || stock_quantity === '' ||
    Number.isNaN(Number(stock_quantity)) || Number(stock_quantity) < 0 || !Number.isInteger(Number(stock_quantity))
  ) {
    errors.push('Stock quantity is required and must be 0 or more.');
  }
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });

  try {
    const [typeRows] = await pool.query('SELECT id FROM item_types WHERE id = ?', [Number(item_type_id)]);
    if (typeRows.length === 0) return res.status(400).json({ error: 'Please select a valid item type.' });

    const [result] = await pool.query(
      'UPDATE items SET name = ?, item_type_id = ?, stock_quantity = ? WHERE id = ?',
      [String(name).trim(), Number(item_type_id), Number(stock_quantity), id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Item not found.' });

    const [rows] = await pool.query(`${CATALOG_JOIN} WHERE items.id = ?`, [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to save item. Please try again.' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  if (Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid item id.' });
  try {
    const [result] = await pool.query('DELETE FROM items WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Item not found.' });
    res.json({ message: 'Item deleted.' });
  } catch (err) {
    if (err && err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'This item is part of an existing purchase and cannot be deleted.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Unable to delete item. Please try again.' });
  }
});

// ------------------------------------------------------------------
// Purchases  (GET/POST /api/purchases, DELETE /api/purchases/:id)
// ------------------------------------------------------------------

// Full JOIN across purchases -> purchase_items -> items -> item_types,
// used everywhere the app needs to show real data (not just IDs).
const FULL_JOIN = `
  SELECT
    purchases.id            AS purchase_id,
    purchases.purchase_date AS purchase_date,
    purchase_items.id       AS purchase_item_id,
    purchase_items.quantity AS quantity,
    items.id                AS item_id,
    items.name               AS item_name,
    items.stock_quantity     AS stock_remaining,
    item_types.type_name     AS item_type_name
  FROM purchases
  JOIN purchase_items ON purchase_items.purchase_id = purchases.id
  JOIN items          ON purchase_items.item_id = items.id
  JOIN item_types     ON items.item_type_id = item_types.id
`;

async function getPurchasesGrouped() {
  const [rows] = await pool.query(`${FULL_JOIN} ORDER BY purchases.id DESC, purchase_items.id ASC`);
  const byPurchase = new Map();
  for (const r of rows) {
    if (!byPurchase.has(r.purchase_id)) {
      byPurchase.set(r.purchase_id, { id: r.purchase_id, purchase_date: r.purchase_date, items: [] });
    }
    byPurchase.get(r.purchase_id).items.push({
      purchase_item_id: r.purchase_item_id,
      item_id: r.item_id,
      item_name: r.item_name,
      item_type_name: r.item_type_name,
      quantity: r.quantity,
      stock_remaining: r.stock_remaining
    });
  }

  // Also include purchases that currently have zero items (e.g. just created,
  // no items added yet) — LEFT JOIN so they still appear.
  const [emptyPurchases] = await pool.query(
    `SELECT id, purchase_date FROM purchases WHERE id NOT IN (SELECT DISTINCT purchase_id FROM purchase_items)`
  );
  for (const p of emptyPurchases) {
    byPurchase.set(p.id, { id: p.id, purchase_date: p.purchase_date, items: [] });
  }

  return [...byPurchase.values()].sort((a, b) => b.id - a.id);
}

// GET /api/purchases - every purchase with its items (grouped), via JOIN
app.get('/api/purchases', async (req, res) => {
  try {
    res.json(await getPurchasesGrouped());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load purchases. Please try again.' });
  }
});

// GET /api/purchase-items - flat row-per-item list (for the main results table)
app.get('/api/purchase-items', async (req, res) => {
  try {
    const [rows] = await pool.query(`${FULL_JOIN} ORDER BY purchases.id DESC, purchase_items.id ASC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load purchase items. Please try again.' });
  }
});

// POST /api/purchases - create a new purchase header (e.g. "Purchase 1"), items added after
app.post('/api/purchases', async (req, res) => {
  const { purchase_date } = req.body || {};
  if (!purchase_date || !isValidDate(purchase_date)) {
    return res.status(400).json({ error: 'Purchase date is required.' });
  }
  try {
    const [result] = await pool.query('INSERT INTO purchases (purchase_date) VALUES (?)', [purchase_date]);
    res.status(201).json({ id: result.insertId, purchase_date, items: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to save purchase. Please try again.' });
  }
});

app.delete('/api/purchases/:id', async (req, res) => {
  const { id } = req.params;
  if (Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid purchase id.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM purchases WHERE id = ? FOR UPDATE', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    // Restore stock for every item line before deleting them
    const [lines] = await connection.query(
      'SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ? FOR UPDATE',
      [id]
    );
    for (const line of lines) {
      await connection.query('UPDATE items SET stock_quantity = stock_quantity + ? WHERE id = ?', [line.quantity, line.item_id]);
    }

    await connection.query('DELETE FROM purchases WHERE id = ?', [id]); // purchase_items cascade-deletes
    await connection.commit();
    res.json({ message: 'Purchase deleted and stock restored.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Unable to delete purchase. Please try again.' });
  } finally {
    connection.release();
  }
});

// ------------------------------------------------------------------
// Purchase Items — this is the "Add Item" form: user SELECTS an
// item + enters a QUANTITY, added to a specific, already-created
// purchase. Stock is validated and decremented here.
// ------------------------------------------------------------------

// POST /api/purchases/:purchaseId/items - add one item line to a purchase
app.post('/api/purchases/:purchaseId/items', async (req, res) => {
  const { purchaseId } = req.params;
  if (Number.isNaN(Number(purchaseId))) return res.status(400).json({ error: 'Invalid purchase id.' });

  const errors = validatePurchaseItemInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [purchaseRows] = await connection.query('SELECT id FROM purchases WHERE id = ? FOR UPDATE', [purchaseId]);
    if (purchaseRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    const itemId = Number(req.body.item_id);
    const qty = Number(req.body.quantity);

    const [itemRows] = await connection.query('SELECT id, name, stock_quantity FROM items WHERE id = ? FOR UPDATE', [itemId]);
    if (itemRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Selected item does not exist.' });
    }
    const item = itemRows[0];
    if (qty > item.stock_quantity) {
      await connection.rollback();
      return res.status(400).json({ error: `Not enough stock. Only ${item.stock_quantity} of "${item.name}" available.` });
    }

    const [result] = await connection.query(
      'INSERT INTO purchase_items (purchase_id, item_id, quantity) VALUES (?, ?, ?)',
      [purchaseId, itemId, qty]
    );
    await connection.query('UPDATE items SET stock_quantity = stock_quantity - ? WHERE id = ?', [qty, itemId]);

    await connection.commit();

    const [rows] = await pool.query(`${FULL_JOIN} WHERE purchase_items.id = ?`, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Unable to save item. Please try again.' });
  } finally {
    connection.release();
  }
});

// PUT /api/purchase-items/:id - update a purchase line (change item and/or quantity)
app.put('/api/purchase-items/:id', async (req, res) => {
  const { id } = req.params;
  if (Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid item id.' });

  const errors = validatePurchaseItemInput(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], details: errors });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingLines] = await connection.query(
      'SELECT id, purchase_id, item_id, quantity FROM purchase_items WHERE id = ? FOR UPDATE',
      [id]
    );
    if (existingLines.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Item not found.' });
    }
    const existing = existingLines[0];

    // Restore stock from the old quantity first (so editing the same item's
    // quantity is validated against the correct, restored stock number)
    await connection.query('UPDATE items SET stock_quantity = stock_quantity + ? WHERE id = ?', [
      existing.quantity,
      existing.item_id
    ]);

    const newItemId = Number(req.body.item_id);
    const newQty = Number(req.body.quantity);

    const [itemRows] = await connection.query('SELECT id, name, stock_quantity FROM items WHERE id = ? FOR UPDATE', [newItemId]);
    if (itemRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Selected item does not exist.' });
    }
    const item = itemRows[0];
    if (newQty > item.stock_quantity) {
      await connection.rollback();
      return res.status(400).json({ error: `Not enough stock. Only ${item.stock_quantity} of "${item.name}" available.` });
    }

    await connection.query('UPDATE purchase_items SET item_id = ?, quantity = ? WHERE id = ?', [newItemId, newQty, id]);
    await connection.query('UPDATE items SET stock_quantity = stock_quantity - ? WHERE id = ?', [newQty, newItemId]);

    await connection.commit();

    const [rows] = await pool.query(`${FULL_JOIN} WHERE purchase_items.id = ?`, [id]);
    res.json(rows[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Unable to save item. Please try again.' });
  } finally {
    connection.release();
  }
});

// DELETE /api/purchase-items/:id - remove one item line, restore its stock
app.delete('/api/purchase-items/:id', async (req, res) => {
  const { id } = req.params;
  if (Number.isNaN(Number(id))) return res.status(400).json({ error: 'Invalid item id.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [lines] = await connection.query('SELECT item_id, quantity FROM purchase_items WHERE id = ? FOR UPDATE', [id]);
    if (lines.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Item not found.' });
    }

    await connection.query('UPDATE items SET stock_quantity = stock_quantity + ? WHERE id = ?', [
      lines[0].quantity,
      lines[0].item_id
    ]);
    await connection.query('DELETE FROM purchase_items WHERE id = ?', [id]);

    await connection.commit();
    res.json({ message: 'Item deleted and stock restored.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Unable to delete item. Please try again.' });
  } finally {
    connection.release();
  }
});

// Fallback: serve the frontend for any unmatched non-API route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Purchase Tracker server running at http://localhost:${PORT}`);
});
