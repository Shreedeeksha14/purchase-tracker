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
// Validation helpers
// ------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a single item payload.
 * Returns an array of human-readable error strings (empty array = valid).
 */
function validateItem(item, index) {
  const errors = [];
  const label = typeof index === 'number' ? `Item ${index + 1}: ` : '';

  if (!item || typeof item !== 'object') {
    return [`${label}invalid item payload`];
  }

  if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
    errors.push(`${label}Item Name is required`);
  } else if (item.name.trim().length > 150) {
    errors.push(`${label}Item Name must be 150 characters or fewer`);
  }

  if (
    item.item_type_id === undefined ||
    item.item_type_id === null ||
    item.item_type_id === '' ||
    Number.isNaN(Number(item.item_type_id))
  ) {
    errors.push(`${label}Item Type is required`);
  }

  if (!item.purchase_date || typeof item.purchase_date !== 'string' || !DATE_RE.test(item.purchase_date)) {
    errors.push(`${label}Purchase Date is required and must be in YYYY-MM-DD format`);
  } else {
    const d = new Date(item.purchase_date);
    if (Number.isNaN(d.getTime())) {
      errors.push(`${label}Purchase Date is not a valid date`);
    }
  }

  // stock_available is optional (checkbox) - just make sure if present it's boolean-ish
  if (
    item.stock_available !== undefined &&
    typeof item.stock_available !== 'boolean' &&
    item.stock_available !== 0 &&
    item.stock_available !== 1
  ) {
    errors.push(`${label}Stock Available must be true or false`);
  }

  return errors;
}

// ------------------------------------------------------------------
// Item Types
// ------------------------------------------------------------------

// GET /api/item-types - list all categories for the dropdown
app.get('/api/item-types', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, type_name FROM item_types ORDER BY type_name ASC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/item-types error:', err);
    res.status(500).json({ error: 'Failed to load item types' });
  }
});

// ------------------------------------------------------------------
// Items (with JOIN to item_types for display)
// ------------------------------------------------------------------

const ITEMS_JOIN_QUERY = `
  SELECT
    items.id,
    items.name,
    items.purchase_date,
    items.stock_available,
    items.item_type_id,
    item_types.type_name AS item_type_name
  FROM items
  JOIN item_types ON items.item_type_id = item_types.id
`;

// GET /api/items - fetch all items, joined with their type name
app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await pool.query(`${ITEMS_JOIN_QUERY} ORDER BY items.purchase_date DESC, items.id DESC`);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/items error:', err);
    res.status(500).json({ error: 'Failed to load items' });
  }
});

// POST /api/items - create one or many items in a single "purchase" submission
// Body can be either a single item object, or { items: [ ...itemObjects ] }
app.post('/api/items', async (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : Array.isArray(req.body.items) ? req.body.items : [req.body];

  if (incoming.length === 0) {
    return res.status(400).json({ error: 'No items submitted', details: ['At least one item row is required'] });
  }

  // Validate every row before touching the database
  const allErrors = [];
  incoming.forEach((item, idx) => {
    const rowErrors = validateItem(item, incoming.length > 1 ? idx : undefined);
    allErrors.push(...rowErrors);
  });

  if (allErrors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: allErrors });
  }

  // Verify item_type_id values actually exist (protects the FK + gives a clean error)
  const connection = await pool.getConnection();
  try {
    const typeIds = [...new Set(incoming.map((i) => Number(i.item_type_id)))];
    const [typeRows] = await connection.query('SELECT id FROM item_types WHERE id IN (?)', [typeIds]);
    const validTypeIds = new Set(typeRows.map((r) => r.id));
    const invalid = typeIds.filter((id) => !validTypeIds.has(id));
    if (invalid.length > 0) {
      connection.release();
      return res.status(400).json({ error: 'Validation failed', details: [`Unknown Item Type id(s): ${invalid.join(', ')}`] });
    }

    await connection.beginTransaction();

    const insertedIds = [];
    for (const item of incoming) {
      const [result] = await connection.query(
        'INSERT INTO items (name, purchase_date, stock_available, item_type_id) VALUES (?, ?, ?, ?)',
        [item.name.trim(), item.purchase_date, item.stock_available ? 1 : 0, Number(item.item_type_id)]
      );
      insertedIds.push(result.insertId);
    }

    await connection.commit();

    const [newRows] = await pool.query(`${ITEMS_JOIN_QUERY} WHERE items.id IN (?) ORDER BY items.id ASC`, [insertedIds]);
    res.status(201).json({ message: `${insertedIds.length} item(s) saved`, items: newRows });
  } catch (err) {
    await connection.rollback();
    console.error('POST /api/items error:', err);
    res.status(500).json({ error: 'Failed to save items' });
  } finally {
    connection.release();
  }
});

// PUT /api/items/:id - update a single item
app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || Number.isNaN(Number(id))) {
    return res.status(400).json({ error: 'Invalid item id' });
  }

  const errors = validateItem(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    const [typeRows] = await pool.query('SELECT id FROM item_types WHERE id = ?', [Number(req.body.item_type_id)]);
    if (typeRows.length === 0) {
      return res.status(400).json({ error: 'Validation failed', details: ['Unknown Item Type id'] });
    }

    const [result] = await pool.query(
      'UPDATE items SET name = ?, purchase_date = ?, stock_available = ?, item_type_id = ? WHERE id = ?',
      [req.body.name.trim(), req.body.purchase_date, req.body.stock_available ? 1 : 0, Number(req.body.item_type_id), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const [rows] = await pool.query(`${ITEMS_JOIN_QUERY} WHERE items.id = ?`, [id]);
    res.json({ message: 'Item updated', item: rows[0] });
  } catch (err) {
    console.error('PUT /api/items/:id error:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// DELETE /api/items/:id
app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || Number.isNaN(Number(id))) {
    return res.status(400).json({ error: 'Invalid item id' });
  }

  try {
    const [result] = await pool.query('DELETE FROM items WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ message: 'Item deleted' });
  } catch (err) {
    console.error('DELETE /api/items/:id error:', err);
    res.status(500).json({ error: 'Failed to delete item' });
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
