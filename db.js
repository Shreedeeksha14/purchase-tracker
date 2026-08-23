// db.js
// Sets up one shared MySQL connection pool for the whole app.
// Credentials come from environment variables (loaded from a .env file
// via dotenv, with local-dev defaults as a fallback) so nothing
// sensitive is hard-coded into the source.

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'purchase_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // return DATE columns as plain 'YYYY-MM-DD' strings
});

module.exports = pool;
