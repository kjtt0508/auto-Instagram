// expect: go.setter, go.exported-field, go.nil-nil, go.struct-tags, go.pointer-receiver, arch.domain-purity
package domain

import (
	"database/sql"
	"fmt"
)

type Money struct {
	Yen int64 `json:"yen"`
	cur string
}

func (m *Money) SetYen(y int64) { m.Yen = y }
func Find() (*Money, error) { return nil, nil }
