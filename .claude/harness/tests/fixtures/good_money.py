from dataclasses import dataclass, replace
from enum import Enum


@dataclass(frozen=True)
class Money:
    yen: int

    def __post_init__(self):
        if self.yen < 0:
            raise ValueError("0以上")

    def add(self, other: "Money") -> "Money":
        return replace(self, yen=self.yen + other.yen)


FREE_SHIPPING_THRESHOLD = Money(5000)
STANDARD_SHIPPING_FEE = Money(600)


class DeliveryType(Enum):
    STANDARD = "standard"

    def fee(self, amount: Money) -> Money:
        if amount.yen >= FREE_SHIPPING_THRESHOLD.yen:
            return Money(0)
        return STANDARD_SHIPPING_FEE
