# PHP 実装パターン（PHP 8.2+）

```php
<?php
declare(strict_types=1);
namespace App\Domain\Order;

final class Money                                // 値（P05–P07）
{
    public function __construct(private readonly int $yen)
    {
        if ($yen < 0) { throw new DomainException("金額は0以上: {$yen}"); }
    }
    public static function zero(): self { return new self(0); }
    public function add(Money $other): self { return new self($this->yen + $other->yen); }
    public function isAtLeast(Money $other): bool { return $this->yen >= $other->yen; }
}

final class OrderLines                           // ファーストクラスコレクション（P08）
{
    /** @param list<OrderLine> $lines */
    public function __construct(private readonly array $lines)
    {
        if ($lines === []) { throw new DomainException('注文明細は1件以上'); }
    }
    public function subtotal(): Money
    {
        return array_reduce($this->lines, fn (Money $c, OrderLine $l) => $c->add($l->subtotal()), Money::zero());
    }
}

enum DeliveryType: string                        // 区分（P09）
{
    case Standard = 'STANDARD';
    case Express = 'EXPRESS';
    public function shippingFee(Money $amount): Money
    {
        return match ($this) {
            self::Standard => $amount->isAtLeast(new Money(5000)) ? Money::zero() : new Money(600),
            self::Express => new Money(1200),
        };
    }
}

enum OrderStatus: string                         // 状態（P10）
{
    case Received = 'RECEIVED'; case Shipped = 'SHIPPED'; case Cancelled = 'CANCELLED';
    public function canTransitTo(self $next): bool
    {
        return in_array($next, match ($this) { self::Received => [self::Shipped, self::Cancelled], default => [] }, true);
    }
}
```
- Laravel: Eloquent モデル（`app/Models`）は infrastructure。ドメインは `app/Domain` に純粋な PHP で置き、リポジトリで Eloquent ⇄ ドメインを変換する。
- `match` / `switch` は区分 enum の中だけに閉じ込める（外にあると lint が警告）。
