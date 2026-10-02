package domain

import "errors"

var ErrNegative = errors.New("0以上")

type Money struct {
	yen int64
}

func NewMoney(yen int64) (Money, error) {
	if yen < 0 {
		return Money{}, ErrNegative
	}
	return Money{yen: yen}, nil
}

func (m Money) Add(o Money) Money { return Money{yen: m.yen + o.yen} }
