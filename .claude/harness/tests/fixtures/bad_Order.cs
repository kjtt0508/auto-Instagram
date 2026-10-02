// expect: cs.public-setter, cs.public-field, cs.mutable-field, cs.return-null, arch.domain-purity
using Microsoft.EntityFrameworkCore;
namespace Shop.Domain;

public class Order
{
    public string Number { get; set; }
    public int Count;
    private int _x;
    private readonly int _ok;
    public Order Find() { return null; }
}
