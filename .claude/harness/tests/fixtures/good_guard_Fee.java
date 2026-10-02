package com.x.domain;

public final class Fee {
    private static final Yen CHILD_FEE = new Yen(100);
    private static final Yen SENIOR_FEE = new Yen(80);
    private static final Yen ADULT_FEE = new Yen(200);
    private final Age age;

    public Fee(Age age) { this.age = age; }

    public Yen amount() {
        if (age.isChild()) return CHILD_FEE;
        if (age.isSenior()) return SENIOR_FEE;
        return ADULT_FEE;
    }
}
