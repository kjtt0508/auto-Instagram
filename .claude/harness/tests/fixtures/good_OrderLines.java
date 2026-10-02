package com.example.order.domain;

import java.util.List;

public final class OrderLines {
    private final List<OrderLine> lines;
    public OrderLines(List<OrderLine> lines) {
        this.lines = List.copyOf(lines);
    }
    public int count() {
        int total = 0;
        for (OrderLine l : lines) {
            total = total + 1;
        }
        return total;
    }
}
