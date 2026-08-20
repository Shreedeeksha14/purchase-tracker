-- ============================================================
-- Purchase Tracker - MySQL schema
-- Run this once against your MySQL server, e.g.:
--   mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS purchase_tracker;
USE purchase_tracker;

-- Lookup table for item categories
CREATE TABLE IF NOT EXISTS item_types (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  type_name   VARCHAR(100) NOT NULL UNIQUE
);

-- Main items table (each row = one item entered on a purchase form)
CREATE TABLE IF NOT EXISTS items (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150) NOT NULL,
  purchase_date     DATE NOT NULL,
  stock_available   TINYINT(1) NOT NULL DEFAULT 0,
  item_type_id      INT NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_item_type
    FOREIGN KEY (item_type_id) REFERENCES item_types(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Seed some default categories
INSERT IGNORE INTO item_types (type_name) VALUES
  ('Electronics'),
  ('Furniture'),
  ('Clothing'),
  ('Stationery'),
  ('Groceries'),
  ('Appliances');
