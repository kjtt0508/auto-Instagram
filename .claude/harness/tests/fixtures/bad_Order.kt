// expect: kotlin.var-property, kotlin.var-ctor, kotlin.return-null, kotlin.setter, arch.domain-purity
package com.x.domain

import org.springframework.stereotype.Component

class Order(var no: String) {
    var status: Int = 0
    fun setStatus(s: Int) { status = s }
    fun find(): Order? { return null }
}
