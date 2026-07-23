from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "cleanup_public_data_retention.py"
SPEC = importlib.util.spec_from_file_location("cleanup_public_data_retention", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Transaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Result:
    def __init__(self, count: int):
        self.count = count

    def fetchone(self):
        return (self.count,)


class Connection:
    def __init__(self, counts: dict[str, list[int]]):
        self.counts = counts
        self.calls: list[tuple[str, tuple[int, int]]] = []

    def transaction(self):
        return Transaction()

    def execute(self, statement: str, values: tuple[int, int]):
        name = next(target.name for target in MODULE.RETENTION_TARGETS if target.statement == statement)
        self.calls.append((name, values))
        return Result(self.counts[name].pop(0))


class PublicDataRetentionWorkerTests(unittest.TestCase):
    def test_targets_match_the_documented_retention_contract(self):
        targets = {target.name: target for target in MODULE.RETENTION_TARGETS}
        self.assertEqual(set(targets), {
            "subscription_attempts",
            "contact_attempts",
            "archived_contact_messages",
        })
        self.assertEqual(targets["subscription_attempts"].retention_days, 30)
        self.assertEqual(targets["contact_attempts"].retention_days, 30)
        self.assertEqual(targets["archived_contact_messages"].retention_days, 365)
        for target in targets.values():
            self.assertIn("for update skip locked", target.statement)
            self.assertIn("limit %s", target.statement)
            self.assertNotIn("truncate", target.statement.casefold())
        self.assertIn("status = 'archived'", targets["archived_contact_messages"].statement)

    def test_cleanup_is_bounded_and_stops_after_a_partial_batch(self):
        connection = Connection({
            "subscription_attempts": [2, 1],
            "contact_attempts": [0],
            "archived_contact_messages": [2, 2, 2],
        })

        totals = MODULE.run_retention_cleanup(connection, batch_size=2, max_batches=3)

        self.assertEqual(totals, {
            "subscription_attempts": 3,
            "contact_attempts": 0,
            "archived_contact_messages": 6,
        })
        self.assertEqual(connection.calls, [
            ("subscription_attempts", (30, 2)),
            ("subscription_attempts", (30, 2)),
            ("contact_attempts", (30, 2)),
            ("archived_contact_messages", (365, 2)),
            ("archived_contact_messages", (365, 2)),
            ("archived_contact_messages", (365, 2)),
        ])

    def test_invalid_bounds_fail_before_cleanup(self):
        connection = Connection({})
        for batch_size, max_batches in [(0, 1), (5_001, 1), (1, 0), (1, 101)]:
            with self.subTest(batch_size=batch_size, max_batches=max_batches):
                with self.assertRaises(ValueError):
                    MODULE.run_retention_cleanup(
                        connection,
                        batch_size=batch_size,
                        max_batches=max_batches,
                    )


if __name__ == "__main__":
    unittest.main()
