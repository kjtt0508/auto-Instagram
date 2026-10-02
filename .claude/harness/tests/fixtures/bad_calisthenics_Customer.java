// profile: calisthenics
// expect: calisthenics.instance-vars-java, calisthenics.one-dot, common.else
package com.x.domain;

public final class Customer {
    private final CustomerName name;
    private final EmailAddress email;
    private final Address address;

    public Customer(CustomerName name, EmailAddress email, Address address) {
        this.name = name; this.email = email; this.address = address;
    }
    public boolean livesIn(City city) {
        if (address.isIn(city)) { return true; } else { return false; }
    }
    public String zip() { return address.postal().code().toString(); }
}
