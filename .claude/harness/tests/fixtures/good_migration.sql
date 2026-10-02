CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  number VARCHAR(20) NOT NULL,
  delivery_instruction TEXT, -- nullable: 配達指示は任意入力
  CONSTRAINT uq_orders_number UNIQUE (number)
);
