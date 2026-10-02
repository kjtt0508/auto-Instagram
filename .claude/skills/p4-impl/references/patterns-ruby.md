# Ruby 実装パターン

```ruby
module Domain
  class Money                                    # 値（P05–P07）
    attr_reader :yen

    def initialize(yen)
      raise DomainError, "金額は0以上: #{yen}" if yen.negative?
      @yen = yen
      freeze
    end

    def add(other) = Money.new(yen + other.yen)
    def at_least?(other) = yen >= other.yen
    def ==(other) = other.is_a?(Money) && yen == other.yen
    alias eql? ==
    def hash = yen.hash
  end

  class OrderLines                               # ファーストクラスコレクション（P08）
    def initialize(lines)
      raise DomainError, "注文明細は1件以上" if lines.empty?
      @lines = lines.dup.freeze
      freeze
    end

    def subtotal = @lines.map(&:subtotal).reduce(Money.new(0), :add)
  end

  class DeliveryType                             # 区分（P09）
    FEES = {
      standard: ->(amount) { amount.at_least?(Money.new(5000)) ? Money.new(0) : Money.new(600) },
      express: ->(_amount) { Money.new(1200) }
    }.freeze

    def initialize(code)
      FEES.fetch(code) # 未定義の区分は生成できない
      @code = code
      freeze
    end
    def shipping_fee(amount) = FEES.fetch(@code).call(amount)
  end
end
```
- Rails: `app/models`（ActiveRecord）は infrastructure 扱い。ドメインは `app/domain` に PORO で置き、リポジトリで変換する。
- `attr_accessor` / `attr_writer` / `def x=` は使わない。変更は新しいインスタンスを返す。
