-- expect: sql.add-column, sql.missing-fk, sql.vague-column
CREATE TABLE order_lines (
  id BIGINT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id),
  biko VARCHAR(200) NOT NULL
);
ALTER TABLE orders ADD COLUMN cancelled_at TIMESTAMP;
