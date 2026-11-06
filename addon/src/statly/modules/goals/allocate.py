"""Splits a whole number into parts that add up exactly. Pure."""

from __future__ import annotations

from collections.abc import Sequence


def largest_remainder(
    total: int, weights: Sequence[int], caps: Sequence[int] | None = None
) -> list[int]:
    """Share ``total`` by ``weights`` so the parts add up to it exactly.

    Each part first gets its whole share, and what is left goes one by one to the largest
    remainders, ties to the earlier part. A part never gets more than its cap, and whatever a cap
    keeps out goes to the others. Without room anywhere, the parts add up to less.
    """
    count = len(weights)
    limits = list(caps) if caps is not None else [total] * count
    parts = [0] * count
    remaining = min(total, sum(limits))
    while remaining > 0:
        open_parts = [i for i in range(count) if weights[i] > 0 and parts[i] < limits[i]]
        if not open_parts:
            break
        weight = sum(weights[i] for i in open_parts)
        shares = {i: divmod(remaining * weights[i], weight) for i in open_parts}
        given = 0
        for i in open_parts:
            whole = min(shares[i][0], limits[i] - parts[i])
            parts[i] += whole
            given += whole
        left = remaining - given
        for i in sorted(open_parts, key=lambda i: (-shares[i][1], i)):
            if left == 0:
                break
            if parts[i] < limits[i]:
                parts[i] += 1
                left -= 1
        if left == remaining:
            break
        remaining = left
    return parts
