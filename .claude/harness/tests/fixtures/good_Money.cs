namespace Shop.Domain;

public sealed record Money
{
    public long Yen { get; init; }
    private readonly string _currency = "JPY";
    public Money(long yen)
    {
        if (yen < 0) throw new ArgumentException("0以上");
        Yen = yen;
    }
    public Money Add(Money other) => new(Yen + other.Yen);
}
