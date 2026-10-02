# Java 実装パターン（ハーネスの lint・依存方向チェックを通る形）

パッケージ: `com.example.<ctx>.{domain, application, presentation, infrastructure}`

## 値オブジェクト + 完全コンストラクタ（P05 P06 P07）
```java
public final class Money {
    private static final Money ZERO = new Money(0);
    private final long yen;

    public Money(long yen) {
        if (yen < 0) throw new IllegalArgumentException("金額は0以上: " + yen);
        this.yen = yen;
    }
    public static Money zero() { return ZERO; }

    public Money add(Money other) { return new Money(this.yen + other.yen); }
    public Money times(Quantity quantity) { return quantity.multiply(this); }
    public Money withTax(TaxRate rate) { return new Money(rate.applyTo(yen)); } // 端数処理は TaxRate の責務

    public String displayText() { return String.format("%,d円", yen); } // getter より「何に使うか」
    @Override public boolean equals(Object o) { return o instanceof Money m && m.yen == yen; }
    @Override public int hashCode() { return Long.hashCode(yen); }
}
```
- 検証はコンストラクタで1回だけ。呼び出し側で同じチェックを書かない（P14）。
- 変更メソッドは新しいインスタンスを返す。フィールドは `private final`。

## 数量：範囲を型に閉じ込める
```java
public final class Quantity {
    static final int MIN = 1, MAX = 99;
    private final int value;
    public Quantity(int value) {
        if (value < MIN || value > MAX) throw new IllegalArgumentException("数量は" + MIN + "〜" + MAX + ": " + value);
        this.value = value;
    }
    Money multiply(Money unitPrice) { /* 同一パッケージ内に計算を閉じる */ ... }
}
```

## ファーストクラスコレクション（P08）
```java
public final class OrderLines {
    private final List<OrderLine> lines;

    public OrderLines(List<OrderLine> lines) {
        if (lines.isEmpty()) throw new IllegalArgumentException("注文明細は1件以上");
        this.lines = List.copyOf(lines);            // 防御的コピー＆不変
    }
    public OrderLines add(OrderLine line) {
        var copy = new ArrayList<>(lines); copy.add(line);
        return new OrderLines(copy);
    }
    public Money subtotal() {
        return lines.stream().map(OrderLine::subtotal).reduce(Money.zero(), Money::add);
    }
    public int count() { return lines.size(); }     // List そのものは返さない
}
```

## 区分オブジェクト：振る舞いを enum に（P09）
```java
public enum DeliveryType {
    STANDARD(amount -> amount.isAtLeast(new Money(5000)) ? Money.zero() : new Money(600)),
    EXPRESS(amount -> new Money(1200)),
    PICKUP(amount -> Money.zero());

    private final Function<Money, Money> feeRule;
    DeliveryType(Function<Money, Money> feeRule) { this.feeRule = feeRule; }

    public Money shippingFee(Money orderAmount) { return feeRule.apply(orderAmount); }
}
// 呼び出し側: order.deliveryType().shippingFee(amount)  ← if/switch を書かない
```

## 状態 enum：遷移可否を状態自身が知る（P10）
```java
public enum OrderStatus {
    RECEIVED, SHIPPED, CANCELLED;

    private static final Map<OrderStatus, Set<OrderStatus>> ALLOWED = Map.of(
        RECEIVED, EnumSet.of(SHIPPED, CANCELLED),
        SHIPPED, EnumSet.noneOf(OrderStatus.class),
        CANCELLED, EnumSet.noneOf(OrderStatus.class));

    public boolean canTransitTo(OrderStatus next) { return ALLOWED.get(this).contains(next); }
    public OrderStatus transitTo(OrderStatus next) {
        if (!canTransitTo(next)) throw new IllegalStateException(this + " から " + next + " へは遷移できない");
        return next;
    }
}
```
domain.yaml の `transitions` と一致させる。遷移表は全組み合わせをテストする。

## 集約：尋ねるな、命じよ（P12）
```java
public final class Order {
    private final OrderNumber number;
    private final OrderLines lines;
    private final DeliveryType deliveryType;
    private final OrderStatus status;

    public Order(OrderNumber number, OrderLines lines, DeliveryType deliveryType, OrderStatus status) { ... }

    public Money totalAmount(TaxRate rate) {
        Money subtotal = lines.subtotal();
        return subtotal.add(deliveryType.shippingFee(subtotal)).withTax(rate);
    }
    public Order cancel() {                          // setStatus(CANCELLED) ではなく業務の言葉
        return new Order(number, lines, deliveryType, status.transitTo(OrderStatus.CANCELLED));
    }
}
```
状態が頻繁に変わり不変だと扱いにくいエンティティだけ、ADR を書いてファイルに `// harness-allow-file: P06 ADR-000x`。その場合も setter は作らない。

## 未設定を型で表す（P13）
```java
public Optional<Order> findBy(OrderNumber number);           // repository
public sealed interface Discount permits NoDiscount, RateDiscount { Money applyTo(Money m); }
```

## 仕様（業務ルール）オブジェクト（P11）
```java
public final class FreeShippingSpecification {
    private static final Money THRESHOLD = new Money(5000);
    public boolean isSatisfiedBy(Money orderAmount) { return orderAmount.isAtLeast(THRESHOLD); }
}
```

## アプリケーションサービス：調整だけ（P15）
```java
@Service
public class OrderCancellationService {
    private final OrderRepository orders;
    public OrderCancellationService(OrderRepository orders) { this.orders = orders; }

    @Transactional
    public void cancel(OrderNumber number) {
        Order order = orders.findBy(number).orElseThrow(() -> new OrderNotFoundException(number));
        orders.save(order.cancel());
    }
}
```

## プレゼンテーション：境界で値オブジェクトへ（P21）
```java
public record OrderLineRequest(@NotBlank String productCode, @NotNull Integer quantity) {
    OrderLine toDomain(ProductCatalog catalog) {
        return new OrderLine(catalog.priceOf(new ProductCode(productCode)), new Quantity(quantity));
    }
}
// IllegalArgumentException は @RestControllerAdvice で 400 + 業務メッセージに変換
```

## インフラ：変換はここで
- JPA エンティティ（`XxxJpaEntity`）は infrastructure に置き、ドメインオブジェクトと相互変換する。
- Kotlin: `data class` + `val` + `init { require(...) }` が完全コンストラクタ、変更は `copy()`。区分は `enum class` に抽象メソッドか関数プロパティ、状態は `sealed class` も有効。
- ドメインに `@Entity` `@Column` を付けない（P16、依存方向チェックで検査）。
- 状態変化は `xxx_events` に INSERT。現在状態はビューか最新イベントから導出（P18）。
