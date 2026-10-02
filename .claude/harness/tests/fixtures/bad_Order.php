<?php
namespace App\Domain;

use Illuminate\Database\Eloquent\Model;

#[SomeAttr]
final class Order extends Model {
    public function __construct(private readonly string $no, private int $count) {}
    public function setCount(int $c): void { $this->count = $c; }
}
// expect: php.setter, php.mutable-property, php.active-record, arch.domain-purity
