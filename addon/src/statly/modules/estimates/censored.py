"""How long answers take, from times of which some are only known roughly. Pure arithmetic.

Answer times are skewed: most are short, a few are long. A log-normal distribution fits them well.
Some times are exact, some only known to lie between two values (Anki stopped its clock at the
deck's limit, but the next answer came soon after), and some only known to be at least the limit.
Such data is called censored. Expectation maximisation finds the distribution anyway: it fills in
what each rough value most likely was, fits, and repeats. Only ``math`` is needed, because Anki's
Python has no numpy.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import NamedTuple

_ROOT_TWO = math.sqrt(2.0)
_ROOT_TWO_PI = math.sqrt(2.0 * math.pi)
_SHORTEST = 0.2
_SIGMA_RANGE = (0.1, 2.5)
_ROUNDS = 40


def _cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / _ROOT_TWO))


def _pdf(z: float) -> float:
    return math.exp(-0.5 * z * z) / _ROOT_TWO_PI


@dataclass(frozen=True)
class LogNormal:
    mu: float
    sigma: float

    @property
    def mean(self) -> float:
        return math.exp(self.mu + self.sigma * self.sigma / 2.0)

    def mean_above(self, limit: float) -> float:
        """The average of the values above ``limit``: what a time cut off there most likely was."""
        if limit <= 0:
            return self.mean
        sigma = self.sigma
        upper = 1.0 - _cdf((math.log(limit) - self.mu) / sigma)
        if upper < 1e-9:
            return limit
        return self.mean * (1.0 - _cdf((math.log(limit) - self.mu - sigma * sigma) / sigma)) / upper


class Observation(NamedTuple):
    """A time in seconds: exact when ``low == high``, at least ``low`` when ``high`` is infinite."""

    low: float
    high: float
    weight: float = 1.0


def fit(
    observations: Iterable[Observation],
    prior: LogNormal | None = None,
    prior_weight: float = 0.0,
) -> LogNormal | None:
    """The log-normal that best explains the observations, pulled towards ``prior`` if given.

    ``prior_weight`` counts as that many answers, so a deck with few answers stays close to the
    person's overall pace. None without observations or prior.
    """
    exact_weight = exact_sum = exact_squares = 0.0
    rough: list[tuple[float, float, float]] = []
    for observation in observations:
        low = math.log(max(observation.low, _SHORTEST))
        if observation.high == observation.low:
            exact_weight += observation.weight
            exact_sum += observation.weight * low
            exact_squares += observation.weight * low * low
        else:
            high = math.inf if math.isinf(observation.high) else math.log(observation.high)
            rough.append((low, high, observation.weight))
    total = exact_weight + sum(weight for _, _, weight in rough)
    if total == 0:
        return prior

    if exact_weight > 0:
        mu = exact_sum / exact_weight
        sigma = math.sqrt(max(exact_squares / exact_weight - mu * mu, 0.0)) or 0.5
    else:
        mu, sigma = sum(low for low, _, _ in rough) / len(rough), 0.5
    if prior is not None and prior_weight > 0:
        mu = (mu * total + prior.mu * prior_weight) / (total + prior_weight)
    sigma = min(max(sigma, _SIGMA_RANGE[0]), _SIGMA_RANGE[1])

    for _ in range(_ROUNDS if rough else 1):
        weight, first, second = exact_weight, exact_sum, exact_squares
        for low, high, share in rough:
            a = (low - mu) / sigma
            b = (high - mu) / sigma
            tail = (_cdf(b) if not math.isinf(b) else 1.0) - _cdf(a)
            if tail < 1e-12:
                expected, variance = low, 0.0
            else:
                density_a = _pdf(a)
                density_b = 0.0 if math.isinf(b) else _pdf(b)
                shift = (density_a - density_b) / tail
                expected = mu + sigma * shift
                spread = (a * density_a - (0.0 if math.isinf(b) else b * density_b)) / tail
                variance = sigma * sigma * max(1.0 + spread - shift * shift, 0.0)
            weight += share
            first += share * expected
            second += share * (variance + expected * expected)
        if prior is not None and prior_weight > 0:
            weight += prior_weight
            first += prior_weight * prior.mu
            second += prior_weight * (prior.sigma * prior.sigma + prior.mu * prior.mu)
        new_mu = first / weight
        new_sigma = math.sqrt(max(second / weight - new_mu * new_mu, 0.0))
        new_sigma = min(max(new_sigma, _SIGMA_RANGE[0]), _SIGMA_RANGE[1])
        settled = abs(new_mu - mu) < 1e-5 and abs(new_sigma - sigma) < 1e-5
        mu, sigma = new_mu, new_sigma
        if settled:
            break
    return LogNormal(mu, sigma)
