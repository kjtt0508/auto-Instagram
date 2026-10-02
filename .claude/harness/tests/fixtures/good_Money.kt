package com.x.domain

data class Money(val yen: Long) {
    init { require(yen >= 0) { "0以上" } }
    fun add(other: Money): Money = Money(yen + other.yen)
    fun times(q: Quantity): Money {
        val total = yen * q.value
        return Money(total)
    }
}
