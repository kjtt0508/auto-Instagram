class Money
  attr_reader :yen

  def initialize(yen)
    raise ArgumentError, "0以上" if yen.negative?
    @yen = yen
    freeze
  end

  def add(other)
    Money.new(yen + other.yen)
  end
end
