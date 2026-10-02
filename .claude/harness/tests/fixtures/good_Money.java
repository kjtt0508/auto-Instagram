package com.acme.order.domain;

public final class Money {
    private final long yen;
    public Money(long yen) {
        if (yen < 0) throw new IllegalArgumentException("x");
        this.yen = yen;
    }
    public Money add(Money o) { return new Money(yen + o.yen); }
}
