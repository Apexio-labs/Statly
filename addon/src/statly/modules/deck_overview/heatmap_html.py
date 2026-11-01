"""Localized markup for the deck overview activity heatmap."""

from __future__ import annotations

from html import escape
from typing import Any

_MONTHS = {
    "de": (
        "Jan",
        "Feb",
        "Mär",
        "Apr",
        "Mai",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Okt",
        "Nov",
        "Dez",
    ),
    "en": (
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ),
}
_TEXT = {
    "de": {
        "activity": "Statly-Lernaktivität",
        "today": "Heute",
        "card": "Karte",
        "cards": "Karten",
        "studied_in": "gelernt in",
        "second": "Sekunde",
        "seconds": "Sekunden",
        "minute": "Minute",
        "minutes": "Minuten",
        "hours": "Std.",
        "learning_activity": "Lernaktivität im Jahr",
        "reviews": "Wiederholungen",
        "weekdays": ("Mo", "", "Mi", "", "Fr"),
        "less": "Weniger",
        "more": "Mehr",
        "daily_average": "Tagesdurchschnitt",
        "study_days": "Lerntage",
        "longest_streak": "Längste Serie",
        "current_streak": "Aktuelle Serie",
        "day": "Tag",
        "days": "Tage",
    },
    "en": {
        "activity": "Statly learning activity",
        "today": "Today",
        "card": "card",
        "cards": "cards",
        "studied_in": "studied in",
        "second": "second",
        "seconds": "seconds",
        "minute": "minute",
        "minutes": "minutes",
        "hours": "hr.",
        "learning_activity": "Learning activity in",
        "reviews": "reviews",
        "weekdays": ("Mo", "", "We", "", "Fr"),
        "less": "Less",
        "more": "More",
        "daily_average": "Daily average",
        "study_days": "Study days",
        "longest_streak": "Longest streak",
        "current_streak": "Current streak",
        "day": "day",
        "days": "days",
    },
}


def _number(value: int, language: str) -> str:
    separator = "." if language == "de" else ","
    return f"{value:,}".replace(",", separator)


def _decimal_number(value: float, language: str) -> str:
    whole, fraction = f"{value:.1f}".split(".")
    grouped_whole = f"{int(whole):,}".replace(",", "." if language == "de" else ",")
    decimal_separator = "," if language == "de" else "."
    return f"{grouped_whole}{decimal_separator}{fraction}"


def _duration(milliseconds: int, language: str) -> str:
    text = _TEXT[language]
    seconds = round(milliseconds / 1000)
    if seconds < 60:
        unit = text["second"] if seconds == 1 else text["seconds"]
        return f"{seconds} {unit}"
    minutes = seconds // 60
    if seconds < 3600:
        unit = text["minute"] if minutes == 1 else text["minutes"]
        return f"{minutes} {unit}"
    hours, remaining_minutes = divmod(minutes, 60)
    duration = f"{hours} {text['hours']}"
    if remaining_minutes:
        duration += f" {remaining_minutes} {text['minutes']}"
    return duration


def render_heatmap_markup(heatmap: dict[str, Any], language: str) -> str:
    if language not in _TEXT:
        raise ValueError(f"Unsupported heatmap language: {language}")
    text = _TEXT[language]
    days = heatmap["days"]
    maximum = max((int(day["value"]) for day in days), default=0)
    week_count = len(days) // 7
    year = int(heatmap["year"])
    month_marks: list[str] = []
    cells: list[str] = []
    for index, day in enumerate(days):
        day_date = str(day["date"])
        value = int(day["value"])
        if day_date[8:10] == "01" and int(day_date[:4]) == year:
            month = _MONTHS[language][int(day_date[5:7]) - 1]
            month_marks.append(f'<span style="grid-column:{index // 7 + 1}">{month}</span>')
        level = 0 if maximum == 0 or value == 0 else min(4, (value * 4 + maximum - 1) // maximum)
        formatted_date = (
            f"{day_date[8:10]}.{day_date[5:7]}.{day_date[:4]}"
            if language == "de"
            else f"{_MONTHS[language][int(day_date[5:7]) - 1]} "
            f"{int(day_date[8:10])}, {day_date[:4]}"
        )
        date_label = f"{formatted_date}: {_number(value, language)} {text['reviews']}"
        escaped_label = escape(date_label, quote=True)
        cells.append(
            '<span class="statly-heatmap-day" '
            f'data-level="{level}" title="{escaped_label}" '
            f'aria-label="{escaped_label}"></span>'
        )

    today_reviews = int(heatmap["todayReviews"])
    average = float(heatmap["dailyAverage"])
    average_label = _number(int(average), language)
    if not average.is_integer():
        average_label = _decimal_number(average, language)
    longest_streak = int(heatmap["longestStreak"])
    current_streak = int(heatmap["currentStreak"])
    learning_activity_label = (
        f"{text['learning_activity']} {year}: "
        f"{_number(int(heatmap['totalReviews']), language)} {text['reviews']}"
    )
    summary = (
        f"{text['today']} {_number(today_reviews, language)} "
        f"{text['card'] if today_reviews == 1 else text['cards']} "
        f"{text['studied_in']} "
        f"{_duration(int(heatmap['todayTimeMs']), language)}."
    )
    metrics = (
        (
            text["daily_average"],
            f"{average_label} {text['reviews']}",
        ),
        (
            text["study_days"],
            f"{_number(int(heatmap['daysLearned']), language)} %",
        ),
        (
            text["longest_streak"],
            f"{_number(longest_streak, language)} "
            f"{text['day'] if longest_streak == 1 else text['days']}",
        ),
        (
            text["current_streak"],
            f"{_number(current_streak, language)} "
            f"{text['day'] if current_streak == 1 else text['days']}",
        ),
    )
    return f"""
        <section class="statly-deck-overview-heatmap" aria-label="{text["activity"]}">
            <div class="statly-heatmap-panel">
            <div class="statly-heatmap-summary">{summary}</div>
            <div class="statly-heatmap" style="--heatmap-weeks:{week_count}" role="img"
                aria-label="{learning_activity_label}">
                <div class="statly-heatmap-months">{"".join(month_marks)}</div>
                <div class="statly-heatmap-body">
                    <div class="statly-heatmap-weekdays" aria-hidden="true">
                        {"".join(f"<span>{weekday}</span>" for weekday in text["weekdays"])}
                    </div>
                    <div class="statly-heatmap-days">{"".join(cells)}</div>
                </div>
                <div class="statly-heatmap-year-caption">{year}</div>
                <div class="statly-heatmap-legend">
                    <span>{text["less"]}</span>
                    {
        "".join(
            f'<span class="statly-heatmap-day" data-level="{level}" aria-hidden="true"></span>'
            for level in range(5)
        )
    }
                    <span>{text["more"]}</span>
                </div>
            </div>
            <div class="statly-heatmap-metrics">
                {
        "".join(
            f"<div><span>{label}</span><strong>{value}</strong></div>" for label, value in metrics
        )
    }
            </div>
            </div>
        </section>
    """
