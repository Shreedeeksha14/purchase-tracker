# Purchase Ledger

A small full-stack app: Node.js/Express backend + MySQL database + a plain HTML/CSS/JS
frontend for logging purchased items and managing them in a table (create, read,
update, delete).

## Features

- **Intake form** — add an item's Name, Type (dropdown), Purchase Date, and Stock
  Available (checkbox). Click **"+ Add another item"** to log several items as part
  of the same purchase submission, then send them all at once with **"Log Purchase."**
- **Ledger table** — lists every item, joined with its type name from the database,
  with inline **Edit** and **Delete** for each row.
- **Validation** — required fields are checked both in the browser and, authoritatively,
  on the server; invalid submissions never reach the database and return clear error
  messages.
- **JOIN-based reads** — `items` is joined to `item_types` on every read so the table
  always shows the human-readable category name, not just an id.

## Project structure

```
purchase-tracker/
├── server.js        # Express app + API routes + validation
├── db.js             # MySQL connection pool (mysql2/promise)
├── schema.sql         # Creates the database, tables, and seed item types
├── package.json
└── public/
    ├── index.html    # Form + table markup
    ├── style.css       # Styling
    └── app.js           # Frontend logic (fetch calls, rendering, inline edit)
```

## 1. Database setup

You need a running MySQL server (local install, Docker, or a managed instance).

```bash
mysql -u root -p < schema.sql
```

This creates the `purchase_tracker` database with two tables:

- **`item_types`** — `id` (PK), `type_name` (unique). Seeded with Electronics,
  Furniture, Clothing, Stationery, Groceries, Appliances.
- **`items`** — `id` (PK), `name`, `purchase_date`, `stock_available`, `item_type_id`
  (FK → `item_types.id`), plus `created_at`/`updated_at` timestamps.

## 2. Backend setup

```bash
npm install
```

Configure your database credentials with environment variables (or edit the
defaults in `db.js`):

```bash
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=root
export DB_PASSWORD=yourpassword
export DB_NAME=purchase_tracker
export PORT=3000            # optional, defaults to 3000
```

Start the server:

```bash
npm start
```

The app (frontend + API) is now served at **http://localhost:3000**.

## API endpoints

| Method | Route              | Description                                             |
|--------|---------------------|-----------------------------------------------------------|
| GET    | `/api/item-types`  | List all item type categories, for the dropdown          |
| GET    | `/api/items`        | List all items, JOINed with their type name               |
| POST   | `/api/items`        | Create one or many items: `{ "items": [ {...}, {...} ] }` |
| PUT    | `/api/items/:id`   | Update a single item                                       |
| DELETE | `/api/items/:id`   | Delete a single item                                        |

All write endpoints validate required fields (`name`, `item_type_id`,
`purchase_date`) and that `item_type_id` refers to a real row in `item_types`
before touching the database, returning `400` with a `details` array of
messages on failure.

## Notes

- `stock_available` is stored as `TINYINT(1)` (0/1) and rendered as an
  "In Stock" / "Out of Stock" stamp in the ledger.
- Dates are stored as SQL `DATE` and returned as plain `YYYY-MM-DD` strings so
  they drop straight into `<input type="date">`.
- The frontend is plain HTML/CSS/JS (no build step) served straight out of
  `public/` by Express — just open the browser once the server is running.
