// Central MySQL connection pool.
// Reads credentials from environment variables so nothing sensitive is hard-coded.
// Falls back to sane local-dev defaults.

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
  dateStrings: true // return DATE columns as 'YYYY-MM-DD' strings, easier for the frontend
});

module.exports = pool;
