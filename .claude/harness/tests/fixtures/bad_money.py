# expect: python.dataclass-not-frozen, python.self-mutation, arch.domain-purity
from dataclasses import dataclass
import sqlalchemy

@dataclass
class Money:
    yen: int

    def __post_init__(self):
        self.yen = int(self.yen)

    def add(self, other):
        self.yen += other.yen  # mutation
        return self
