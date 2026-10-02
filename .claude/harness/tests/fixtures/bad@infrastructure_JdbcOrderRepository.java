// expect: common.sql-update
package com.x.infrastructure;

public class JdbcOrderRepository {
    void cancel(long id) {
        jdbc.update("UPDATE orders SET status = 'CANCELLED' WHERE id = ?", id);
    }
}
