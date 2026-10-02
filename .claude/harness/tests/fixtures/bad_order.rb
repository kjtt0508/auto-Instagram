# expect: ruby.accessor, ruby.active-record, ruby.ivar-mutation
class Order < ApplicationRecord
  attr_accessor :no

  def initialize(no)
    @no = no
  end

  def rename(x)
    @no = x
  end
end
