// expect: java.setter, java.return-null, java.mutable-field, java.raw-collection-field, arch.domain-purity, builtin.vague-name
package com.acme.order.domain;

import org.springframework.stereotype.Component;
import java.util.List;

public class OrderInfo {
    private String no;
    private final List<String> lines = null;
    public void setNo(String no) { this.no = no; }
    public String find() { return null; }
}
