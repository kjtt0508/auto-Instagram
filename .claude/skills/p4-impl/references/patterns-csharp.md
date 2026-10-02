# C# 実装パターン

```csharp
namespace Shop.Domain;

public sealed record Money                       // 値（P05–P07）
{
    public long Yen { get; }
    public Money(long yen)
    {
        if (yen < 0) throw new DomainException($"金額は0以上: {yen}");
        Yen = yen;
    }
    public static readonly Money Zero = new(0);
    public Money Add(Money other) => new(Yen + other.Yen);
    public bool IsAtLeast(Money other) => Yen >= other.Yen;
}

public sealed class OrderLines                   // ファーストクラスコレクション（P08）
{
    private readonly IReadOnlyList<OrderLine> _lines;
    public OrderLines(IEnumerable<OrderLine> lines)
    {
        _lines = lines.ToList().AsReadOnly();
        if (_lines.Count == 0) throw new DomainException("注文明細は1件以上");
    }
    public Money Subtotal() => _lines.Aggregate(Money.Zero, (acc, l) => acc.Add(l.Subtotal()));
}

public sealed record DeliveryType                // 区分：スマート enum（P09）
{
    public static readonly DeliveryType Standard = new("STANDARD", a => a.IsAtLeast(new Money(5000)) ? Money.Zero : new Money(600));
    public static readonly DeliveryType Express = new("EXPRESS", _ => new Money(1200));
    public string Code { get; }
    private readonly Func<Money, Money> _fee;
    private DeliveryType(string code, Func<Money, Money> fee) { Code = code; _fee = fee; }
    public Money ShippingFee(Money amount) => _fee(amount);
}

public sealed record Order(OrderNumber Number, OrderLines Lines, OrderStatus Status)
{
    public Order Cancel() => Status.CanTransitTo(OrderStatus.Cancelled)
        ? this with { Status = OrderStatus.Cancelled }
        : throw new DomainException("取消できない状態");
}
```
- EF Core の設定は Infrastructure の `IEntityTypeConfiguration<T>` で行い、ドメインに属性（`[Key]` 等）を付けない。
- `{ get; set; }` は禁止。`init` か業務の言葉のメソッドで。
- プロジェクト分割（`Shop.Domain` / `Shop.Application` / `Shop.Web` / `Shop.Infrastructure`）でもディレクトリ名でレイヤ判定される。
