# Python 実装パターン

```python
from __future__ import annotations
from dataclasses import dataclass, replace
from enum import Enum
from typing import Callable

@dataclass(frozen=True)
class Money:                      # 値（P05–P07）
    yen: int
    def __post_init__(self):
        if self.yen < 0:
            raise ValueError(f"金額は0以上: {self.yen}")
    def add(self, other: Money) -> Money:
        return Money(self.yen + other.yen)
    def is_at_least(self, other: Money) -> bool:
        return self.yen >= other.yen

@dataclass(frozen=True)
class OrderLines:                 # ファーストクラスコレクション（P08）
    _lines: tuple[OrderLine, ...]
    def __post_init__(self):
        if not self._lines:
            raise ValueError("注文明細は1件以上")
    def subtotal(self) -> Money:
        return sum((l.subtotal() for l in self._lines), Money(0))

class DeliveryType(Enum):         # 区分（P09）
    STANDARD = "standard"
    EXPRESS = "express"
    def shipping_fee(self, amount: Money) -> Money:
        return _FEES[self](amount)

_FEES: dict[DeliveryType, Callable[[Money], Money]] = {
    DeliveryType.STANDARD: lambda a: Money(0) if a.is_at_least(Money(5000)) else Money(600),
    DeliveryType.EXPRESS: lambda a: Money(1200),
}

class OrderStatus(Enum):          # 状態（P10）
    RECEIVED = "received"; SHIPPED = "shipped"; CANCELLED = "cancelled"
    def can_transit_to(self, nxt: OrderStatus) -> bool:
        return nxt in _TRANSITIONS[self]
_TRANSITIONS = {OrderStatus.RECEIVED: {OrderStatus.SHIPPED, OrderStatus.CANCELLED},
                OrderStatus.SHIPPED: set(), OrderStatus.CANCELLED: set()}

@dataclass(frozen=True)
class Order:                      # 集約：変更は新しい値を返す（P06, P12）
    number: OrderNumber
    lines: OrderLines
    status: OrderStatus
    def cancel(self) -> Order:
        if not self.status.can_transit_to(OrderStatus.CANCELLED):
            raise OrderStateError(self.status)
        return replace(self, status=OrderStatus.CANCELLED)
```
- リポジトリは `typing.Protocol` を domain に置き、SQLAlchemy / Django ORM の実装は infrastructure に。
- Django の場合: `models.py` は永続化モデル（infrastructure 扱い）。ドメインは `domain/` パッケージに純粋な Python で置き、リポジトリで変換する。
- Pydantic は presentation（リクエスト/レスポンス）で使い、ドメインへは変換して渡す。
- アプリケーション層の関数は「取得→命じる→保存」だけ。トランザクションはここで張る。
