// expect: common.abbreviation, common.magic-number, builtin.too-many-params, common.else, builtin.nesting, common.compound-condition, java.static-method, common.single-letter
package com.x.domain;

public final class Pricing {
    private final int qty;
    public Pricing(int qty) { this.qty = qty; }

    public static int price(int unitPrice, int quantity, int age, boolean member, String couponCd) {
        int p = quantity * unitPrice;
        if (age < 13 && member || couponCd != null) {
            if (p < 3000) {
                if (member) {
                    p += 500;
                }
            }
        } else {
            p += 1000;
        }
        return p;
    }
}
