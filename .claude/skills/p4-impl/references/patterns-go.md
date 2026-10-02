# Go 実装パターン

```go
package domain

// 値（P05–P07）：非公開フィールド + コンストラクタ関数 + 値レシーバ
type Money struct{ yen int64 }

var ErrNegativeMoney = errors.New("金額は0以上")

func NewMoney(yen int64) (Money, error) {
	if yen < 0 {
		return Money{}, ErrNegativeMoney
	}
	return Money{yen: yen}, nil
}
func (m Money) Add(o Money) Money          { return Money{yen: m.yen + o.yen} }
func (m Money) IsAtLeast(o Money) bool     { return m.yen >= o.yen }

// ファーストクラスコレクション（P08）
type OrderLines struct{ lines []OrderLine }

func NewOrderLines(ls []OrderLine) (OrderLines, error) {
	if len(ls) == 0 {
		return OrderLines{}, ErrEmptyOrderLines
	}
	return OrderLines{lines: append([]OrderLine(nil), ls...)}, nil // コピー
}
func (o OrderLines) Subtotal() Money { /* 集計はここで */ }

// 区分（P09）：switch は区分型のメソッドの中だけに閉じ込める
type DeliveryType string

const (
	Standard DeliveryType = "STANDARD"
	Express  DeliveryType = "EXPRESS"
)

func (d DeliveryType) ShippingFee(amount Money) Money {
	switch d {
	case Express:
		return Money{yen: 1200}
	default:
		if amount.IsAtLeast(Money{yen: 5000}) {
			return Money{}
		}
		return Money{yen: 600}
	}
}

// 状態（P10）
type OrderStatus string

var transitions = map[OrderStatus][]OrderStatus{Received: {Shipped, Cancelled}}

func (s OrderStatus) CanTransitTo(n OrderStatus) bool { return slices.Contains(transitions[s], n) }

// 集約：変更は新しい値を返す
func (o Order) Cancel() (Order, error) {
	if !o.status.CanTransitTo(Cancelled) {
		return Order{}, ErrInvalidTransition
	}
	o.status = Cancelled // 値レシーバなので呼び出し元は変わらない
	return o, nil
}
```
- 「見つからない」は `(Order{}, ErrOrderNotFound)`。`(nil, nil)` を返さない（P13）。
- リポジトリの interface は domain に、`database/sql` / GORM の実装は infrastructure に。JSON / DB タグはドメインの struct に付けず、DTO を別に定義する。
- `internal/` 配下に `domain`, `usecase`, `handler`, `infra` を置けばレイヤ判定がそのまま効く。
