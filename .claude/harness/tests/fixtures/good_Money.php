<?php
declare(strict_types=1);
namespace App\Domain;

final class Money
{
    public function __construct(private readonly int $yen)
    {
        if ($yen < 0) { throw new \InvalidArgumentException('0以上'); }
    }
    public function add(Money $other): self { return new self($this->yen + $other->yen); }
}
