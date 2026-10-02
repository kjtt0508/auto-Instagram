-- expect: sql.nullable, sql.drop
CREATE TABLE t (
  id BIGINT PRIMARY KEY,
  note TEXT
);
DROP TABLE old;
