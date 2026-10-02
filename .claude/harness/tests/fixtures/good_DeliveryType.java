package com.example.order.domain;

import java.util.function.Function;

public enum DeliveryType {
    STANDARD(amount -> amount.isAtLeast(new Money(5000)) ? Money.zero() : new Money(600)),
    EXPRESS(amount -> new Money(1200)),
    PICKUP(amount -> Money.zero());

    private final Function<Money, Money> feeRule;
    DeliveryType(Function<Money, Money> feeRule) { this.feeRule = feeRule; }
    public Money shippingFee(Money orderAmount) { return feeRule.apply(orderAmount); }
}
