(function() {
	// ../contract/src/charts.ts
	/**
	* What each series runs along. Only series along the same axis can share a combined chart, and
	* series that list things of their own, such as decks, combine only with themselves.
	*/
	var seriesAxisOf = {
		timeline: "days",
		ratingTimeline: "days",
		retentionTimeline: "days",
		speedTimeline: "days",
		timeTimeline: "days",
		newTimeline: "days",
		forecast: "futureDays",
		creationTimeline: "creation",
		hours: "hours",
		sessionHours: "hours",
		focusHours: "hours",
		weekdays: "weekdays",
		answerButtons: "answerButtons",
		deckActivity: "deckActivity",
		cardStates: "cardStates",
		forgottenCards: "forgottenCards",
		weakestDecks: "weakestDecks",
		newCardsFrom: "newCardsFrom",
		deckStability: "deckStability"
	};
	/** The unit of each series. Series with the same unit share a scale in a combined chart. */
	var seriesUnitOf = {
		timeline: "count",
		ratingTimeline: "count",
		retentionTimeline: "percent",
		speedTimeline: "seconds",
		timeTimeline: "minutes",
		newTimeline: "count",
		forecast: "count",
		creationTimeline: "minutes",
		hours: "count",
		sessionHours: "count",
		focusHours: "percent",
		weekdays: "count",
		answerButtons: "count",
		deckActivity: "count",
		cardStates: "count",
		forgottenCards: "count",
		weakestDecks: "percent",
		newCardsFrom: "count",
		deckStability: "days"
	};
	/** The series that can share a combined chart with ``source``, itself included. */
	function combinesWith(source, other) {
		return seriesAxisOf[source] === seriesAxisOf[other];
	}
	/**
	* Gives every layer a scale. Layers with the same unit share one, so two counts never stand on
	* two different scales. Chosen sides come first; "auto" then puts the first new unit left, the
	* next right, and so on, until both sides are full; the rest get a hidden scale.
	*/
	function planAxes(layers) {
		const axes = [];
		const layerAxis = new Array(layers.length).fill(-1);
		const onSide = (side) => axes.filter((axis) => axis.side === side).length;
		const visible = (unit, side) => axes.findIndex((axis) => axis.side !== "hidden" && axis.unit === unit && (side === void 0 || axis.side === side));
		const place = (side, unit) => {
			const count = onSide(side);
			if (count >= 2) return -1;
			axes.push({
				side,
				slot: count,
				unit
			});
			return axes.length - 1;
		};
		const hidden = (unit) => {
			const found = axes.findIndex((axis) => axis.side === "hidden" && axis.unit === unit);
			if (found >= 0) return found;
			axes.push({
				side: "hidden",
				unit
			});
			return axes.length - 1;
		};
		layers.forEach((layer, index) => {
			if (layer.axis === "left" || layer.axis === "right") {
				const found = visible(layer.unit, layer.axis);
				const placed = found >= 0 ? found : place(layer.axis, layer.unit);
				layerAxis[index] = placed >= 0 ? placed : hidden(layer.unit);
			}
		});
		layers.forEach((layer, index) => {
			if (layer.axis !== "auto") return;
			const found = visible(layer.unit);
			if (found >= 0) {
				layerAxis[index] = found;
				return;
			}
			const first = onSide("left") <= onSide("right") ? "left" : "right";
			const second = first === "left" ? "right" : "left";
			const placed = place(first, layer.unit);
			const placedElsewhere = placed >= 0 ? placed : place(second, layer.unit);
			layerAxis[index] = placedElsewhere >= 0 ? placedElsewhere : hidden(layer.unit);
		});
		layers.forEach((layer, index) => {
			if (layer.axis === "none") layerAxis[index] = hidden(layer.unit);
		});
		return {
			axes,
			layerAxis
		};
	}
	// ../widget-runtime/src/layout.ts
	function distance(first, second) {
		return Math.abs(first.w - second.w) + Math.abs(first.h - second.h);
	}
	/**
	* Where an element sits at a widget size. Percentages make it scale by themselves. If the user
	* arranged it for particular sizes, the arrangement closest to the current size applies.
	*/
	function layoutAt(element, size, cells) {
		let best = element;
		let bestDistance = distance(size, cells);
		for (const layout of element.layouts ?? []) {
			const away = distance({
				w: layout.cellsW,
				h: layout.cellsH
			}, cells);
			if (away < bestDistance) {
				best = layout;
				bestDistance = away;
			}
		}
		return best;
	}
	/** Elements can wait until the widget is large enough for them. */
	function isVisibleAt(element, cells) {
		const from = element.showFrom;
		return !from || cells.w >= from.w && cells.h >= from.h;
	}
	var COLUMN_PX = 104;
	var ROW_PX = 45;
	var GAP_PX = 14;
	function cellsToPixels(cells) {
		return {
			width: cells.w * COLUMN_PX - GAP_PX,
			height: cells.h * ROW_PX - GAP_PX
		};
	}
	/** Height over width of the size a widget was designed at, which keeps text proportional. */
	function designAspect(size) {
		const { width, height } = cellsToPixels(size);
		return height / width;
	}
	// ../widget-runtime/src/style.ts
	var THEME_PAINTS = {
		text: "var(--statly-text)",
		muted: "var(--statly-muted)",
		accent: "var(--statly-accent)",
		card: "var(--statly-card)"
	};
	/** Theme colors follow the active theme, fixed colors stay as chosen. */
	function paintValue(paint) {
		return THEME_PAINTS[paint] ?? paint;
	}
	function boxStyle(box, opacity = 1, rotation = 0) {
		return {
			position: "absolute",
			left: `${box.x}%`,
			top: `${box.y}%`,
			width: `${box.w}%`,
			height: `${box.h}%`,
			opacity,
			...rotation ? { transform: `rotate(${rotation}deg)` } : {}
		};
	}
	/**
	* Text scales with the smaller of height and width, relative to the size it was designed at.
	* So it still fits when a widget gets narrow, instead of running out of its box.
	*/
	function textStyle(element, aspect) {
		return {
			fontSize: `min(${element.size}cqh, ${element.size * aspect}cqw)`,
			fontWeight: element.bold ? 700 : 400,
			textAlign: element.align,
			color: paintValue(element.color),
			lineHeight: 1.15
		};
	}
	function backgroundStyle(background, mediaUrl) {
		switch (background.kind) {
			case "color": return { background: background.color };
			case "gradient": return { background: `linear-gradient(${background.angle}deg, ${background.start}, ${background.end})` };
			case "media": {
				const shade = `rgb(0 0 0 / ${Math.round(background.shade * 100)}%)`;
				return background.asset.type.startsWith("image/") && mediaUrl ? {
					backgroundImage: `linear-gradient(${shade}, ${shade}), url("${mediaUrl}")`,
					backgroundSize: background.fit,
					backgroundPosition: "center",
					backgroundRepeat: "no-repeat"
				} : { background: "#000000" };
			}
			default: return { background: "var(--statly-widget, var(--statly-card))" };
		}
	}
	// src/render.ts
	var SVG_NS = "http://www.w3.org/2000/svg";
	var TABLET_FROM_PX = 700;
	var COLUMNS = {
		tablet: 8,
		phone: 4
	};
	function element(tag, className, text) {
		const node = document.createElement(tag);
		node.className = className;
		if (text !== void 0) node.textContent = text;
		return node;
	}
	function svgNode(tag, attributes) {
		const node = document.createElementNS(SVG_NS, tag);
		for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
		return node;
	}
	function rows(bars, onPick) {
		const highest = Math.max(1, ...bars.map((bar) => bar.value));
		const list = element("div", "statly-rows");
		bars.forEach((bar, index) => {
			const row = element("div", "statly-row");
			if (onPick) row.addEventListener("click", (event) => {
				event.stopPropagation();
				onPick(index);
			});
			row.append(element("span", "statly-row-label", bar.label));
			const track = element("span", "statly-row-track");
			const fill = element("span", "statly-row-fill");
			fill.style.width = `${bar.value / highest * 100}%`;
			track.append(fill);
			row.append(track, element("span", "statly-row-value", bar.value.toLocaleString()));
			list.append(row);
		});
		return list;
	}
	/** Stretches with its cell, because a phone decides the room and not the data. */
	function columnChart(bars, label, color) {
		const width = 320;
		const height = 110;
		const highest = Math.max(1, ...bars.map((bar) => bar.value));
		const step = width / Math.max(1, bars.length);
		const svg = svgNode("svg", {
			viewBox: `0 0 ${width} ${height}`,
			role: "img",
			preserveAspectRatio: "none"
		});
		svg.setAttribute("aria-label", label);
		bars.forEach((bar, index) => {
			const barHeight = Math.max(bar.value > 0 ? 2 : 0, bar.value / highest * 108);
			const rect = svgNode("rect", {
				x: index * step + step * .12,
				y: height - barHeight,
				width: step * .76,
				height: barHeight,
				rx: 2,
				class: "statly-bar"
			});
			if (color) rect.style.fill = color;
			svg.append(rect);
		});
		return svg;
	}
	function lineChart(bars, label, color) {
		const width = 320;
		const height = 110;
		const highest = Math.max(1, ...bars.map((bar) => bar.value));
		const step = width / Math.max(1, bars.length - 1);
		const points = bars.map((bar, index) => `${index * step},${height - bar.value / highest * 106 - 2}`).join(" ");
		const svg = svgNode("svg", {
			viewBox: `0 0 ${width} ${height}`,
			role: "img",
			preserveAspectRatio: "none"
		});
		svg.setAttribute("aria-label", label);
		const line = svgNode("polyline", {
			points,
			fill: "none",
			"stroke-width": 2,
			"vector-effect": "non-scaling-stroke"
		});
		line.style.stroke = color;
		svg.append(line);
		return svg;
	}
	/** Each point's share of the whole as a slice, each a little lighter than the one before. */
	function pieChart(bars, label, color) {
		const shown = bars.filter((bar) => bar.value > 0);
		const total = shown.reduce((sum, bar) => sum + bar.value, 0);
		const svg = svgNode("svg", {
			viewBox: "0 0 100 100",
			role: "img",
			class: "statly-pie"
		});
		svg.setAttribute("aria-label", label);
		let start = -Math.PI / 2;
		shown.forEach((bar, index) => {
			const angle = total ? bar.value / total * 2 * Math.PI : 0;
			const end = start + angle;
			const point = (at) => `${50 + 46 * Math.cos(at)} ${50 + 46 * Math.sin(at)}`;
			const shape = shown.length === 1 ? svgNode("circle", {
				cx: 50,
				cy: 50,
				r: 46
			}) : svgNode("path", { d: `M50 50 L${point(start)} A46 46 0 ${angle > Math.PI ? 1 : 0} 1 ${point(end)} Z` });
			shape.style.fill = color;
			shape.style.opacity = String(Math.max(.3, 1 - index * (.7 / Math.max(1, shown.length))));
			shape.style.stroke = "var(--statly-card)";
			shape.style.strokeWidth = "1.5";
			const title = svgNode("title", {});
			title.textContent = `${bar.label}: ${bar.value.toLocaleString()}`;
			shape.append(title);
			svg.append(shape);
			start = end;
		});
		return svg;
	}
	/**
	* How each kind of a combined chart draws one layer. Every kind the editor offers under
	* "Combined" needs an entry here, which the type makes sure of.
	*/
	var layerPainters = {
		bar: ({ svg, values, highest, color, slot, slots, step, height }) => {
			const width = step * .76 / slots;
			values.forEach((value, index) => {
				const barHeight = Math.max(value > 0 ? 2 : 0, value / highest * (height - 2));
				const rect = svgNode("rect", {
					x: index * step + step * .12 + slot * width,
					y: height - barHeight,
					width,
					height: barHeight,
					rx: 2,
					class: "statly-bar"
				});
				rect.style.fill = color;
				svg.append(rect);
			});
		},
		line: ({ svg, values, highest, color, step, height }) => {
			const line = svgNode("polyline", {
				points: values.map((value, index) => `${index * step + step / 2},${height - value / highest * (height - 4) - 2}`).join(" "),
				fill: "none",
				"stroke-width": 2,
				"vector-effect": "non-scaling-stroke"
			});
			line.style.stroke = color;
			svg.append(line);
		}
	};
	/**
	* Several layers in one plot. A card has no room for scales, so each unit gets a scale of its own
	* that fills the height, as the desktop's scales do; layers with the same unit share one.
	*/
	function combinedChart(layers, series, label) {
		const width = 320;
		const height = 110;
		const first = layers[0];
		const kept = layers.map((layer, index) => ({
			layer,
			points: series[index] ?? []
		})).filter(({ layer }) => first !== void 0 && combinesWith(first.source, layer.source));
		const labels = kept.reduce((best, { points }) => points.length > best.length ? points : best, []).map((point) => point.label);
		const values = kept.map(({ points }) => {
			const byLabel = new Map(points.map((point) => [point.label, point.value]));
			return labels.map((name) => byLabel.get(name) ?? 0);
		});
		const plan = planAxes(kept.map(({ layer }) => ({
			axis: layer.axis,
			unit: seriesUnitOf[layer.source]
		})));
		const highestOf = plan.axes.map((_axis, axisIndex) => Math.max(1, ...values.flatMap((row, index) => plan.layerAxis[index] === axisIndex ? row : [])));
		const svg = svgNode("svg", {
			viewBox: `0 0 ${width} ${height}`,
			role: "img",
			preserveAspectRatio: "none"
		});
		svg.setAttribute("aria-label", label);
		const step = width / Math.max(1, labels.length);
		const bars = kept.filter(({ layer }) => layer.kind === "bar").map(({ layer }) => layer.id);
		const order = [...kept.keys()].sort((a, b) => Number(kept[a]?.layer.kind === "line") - Number(kept[b]?.layer.kind === "line"));
		for (const index of order) {
			const entry = kept[index];
			if (!entry) continue;
			layerPainters[entry.layer.kind]({
				svg,
				values: values[index] ?? [],
				highest: highestOf[plan.layerAxis[index] ?? 0] ?? 1,
				color: paintValue(entry.layer.color),
				slot: Math.max(0, bars.indexOf(entry.layer.id)),
				slots: Math.max(1, bars.length),
				step,
				height
			});
		}
		return svg;
	}
	function barAt(svg, event, count) {
		const bounds = svg.getBoundingClientRect();
		const share = (event.clientX - bounds.left) / bounds.width;
		return Math.max(0, Math.min(count - 1, Math.floor(share * count)));
	}
	function axisOf(bars) {
		const axis = element("div", "statly-axis");
		axis.append(element("span", "", bars[0]?.label ?? ""), element("span", "", bars[bars.length - 1]?.label ?? ""));
		return axis;
	}
	function renderBars(block, onPick) {
		if (block.horizontal) return rows(block.bars, onPick);
		const svg = columnChart(block.bars, block.label);
		if (onPick) svg.addEventListener("click", (event) => {
			event.stopPropagation();
			onPick(barAt(svg, event, block.bars.length));
		});
		const wrapper = element("div", "statly-chart");
		wrapper.append(svg, axisOf(block.bars));
		return wrapper;
	}
	function heatGrid(levels, label) {
		const size = 11;
		const svg = svgNode("svg", {
			viewBox: `0 0 ${Math.ceil(levels.length / 7) * size} 77`,
			role: "img"
		});
		svg.setAttribute("aria-label", label);
		levels.forEach((level, index) => {
			svg.append(svgNode("rect", {
				x: Math.floor(index / 7) * size,
				y: index % 7 * size,
				width: 9,
				height: 9,
				rx: 2,
				class: `statly-heat statly-heat-${level}`
			}));
		});
		return svg;
	}
	function renderHeatmap(block) {
		const wrapper = element("div", "statly-chart");
		wrapper.append(heatGrid(block.levels, block.label), element("p", "statly-note", block.note));
		return wrapper;
	}
	/** Rows with a name, a line below it and a few values, such as decks or forgotten cards. */
	function renderTable(block, limit) {
		const table = element("div", "statly-table");
		table.style.setProperty("--statly-table-columns", String(block.columns.length));
		const head = element("div", "statly-table-row statly-table-head");
		head.append(element("span", ""), ...block.columns.map((name) => element("span", "", name)));
		table.append(head);
		for (const row of block.rows.slice(0, limit)) {
			const line = element("div", "statly-table-row");
			const name = element("span", "statly-table-name");
			name.append(element("span", "", row.label));
			if (row.sub) name.append(element("small", "", row.sub));
			line.append(name);
			row.cells.forEach((cell, index) => {
				const value = element("span", "statly-table-cell", cell);
				if (index === 0 && row.tone) value.classList.add(`statly-tone-${row.tone}`);
				line.append(value);
			});
			table.append(line);
		}
		return table;
	}
	function fitText(text, style) {
		const box = element("div", "statly-fit");
		Object.assign(box.style, style);
		box.append(element("span", "", text));
		return box;
	}
	function progress(element_, block) {
		const value = block.values[element_.id];
		const share = value?.share ?? 0;
		const color = paintValue(element_.color);
		if (element_.style === "bar") {
			const track = element("div", "statly-progress");
			const fill = element("div", "statly-progress-fill");
			fill.style.width = `${share * 100}%`;
			fill.style.background = color;
			track.append(fill);
			return track;
		}
		const radius = 42;
		const circumference = 2 * Math.PI * radius;
		const svg = svgNode("svg", {
			viewBox: "0 0 100 100",
			role: "img",
			class: "statly-ring"
		});
		svg.setAttribute("aria-label", element_.source);
		const circle = {
			cx: 50,
			cy: 50,
			r: radius,
			fill: "none",
			"stroke-width": 10
		};
		const track = svgNode("circle", circle);
		track.style.stroke = "var(--statly-hover)";
		const arc = svgNode("circle", {
			...circle,
			"stroke-linecap": "round",
			"stroke-dasharray": `${share * circumference} ${circumference}`,
			transform: "rotate(-90 50 50)"
		});
		arc.style.stroke = color;
		const label = svgNode("text", {
			x: 50,
			y: 50,
			"text-anchor": "middle",
			"dominant-baseline": "central",
			"font-size": 16,
			"font-weight": 700
		});
		label.style.fill = "var(--statly-text)";
		label.textContent = value?.text ?? "";
		svg.append(track, arc, label);
		return svg;
	}
	function media(item, block, words) {
		const url = block.media[item.asset.id];
		if (item.asset.type.startsWith("video/")) return element("div", "statly-video-note", words.videoHere);
		if (!url) return null;
		const image = document.createElement("img");
		image.src = url;
		image.alt = "";
		image.className = "statly-media";
		image.style.objectFit = item.fit;
		image.style.borderRadius = `${item.radius}%`;
		return image;
	}
	function shape(item) {
		const box = element("div", "statly-fill");
		box.style.background = paintValue(item.fill);
		box.style.borderRadius = item.shape === "ellipse" ? "50%" : `${item.radius}%`;
		return box;
	}
	function elementContent(item, block, aspect, words) {
		const value = block.values[item.id];
		switch (item.kind) {
			case "text": return fitText(item.text, textStyle(item, aspect));
			case "metric": return fitText(value?.text ?? "", textStyle(item, aspect));
			case "chart": {
				const color = paintValue(item.color);
				if (item.chart === "combined" && item.layers?.length && value?.layers) return combinedChart(item.layers, value.layers, item.source);
				const bars = value?.bars ?? [];
				return (item.chart === "line" ? lineChart : item.chart === "pie" ? pieChart : columnChart)(bars, item.source, color);
			}
			case "progress": return progress(item, block);
			case "heatmap": return heatGrid(value?.levels ?? [], "heatmap");
			case "media": return media(item, block, words);
			case "shape": return shape(item);
			default: return null;
		}
	}
	/** The same rules as on the desktop, so one widget fits every device. */
	function renderCustom(block, cells, words) {
		const { widget } = block;
		const background = widget.background;
		const picture = background.kind === "media" ? block.media[background.asset.id] : void 0;
		const frame = element("section", "statly-custom");
		Object.assign(frame.style, backgroundStyle(background, picture));
		const aspect = designAspect(widget.size);
		for (const item of widget.elements) if (isVisibleAt(item, cells)) {
			const content = elementContent(item, block, aspect, words);
			if (content) {
				const box = document.createElement("div");
				Object.assign(box.style, boxStyle(layoutAt(item, widget.size, cells), item.opacity, item.rotation));
				box.append(content);
				frame.append(box);
			}
		}
		return frame;
	}
	function renderBlock(block, cells, words, open) {
		if (block.kind === "custom") return renderCustom(block, cells, words);
		const card = element("section", "statly-block");
		card.append(element("h2", "statly-label", block.label));
		if (block.kind === "tile") {
			const tile = element("div", "statly-tile");
			tile.append(element("div", "statly-value", block.value), element("p", "statly-note", block.note));
			card.append(tile);
		} else if (block.kind === "bars") {
			if (block.note) card.append(element("p", "statly-note statly-period", block.note));
			card.append(renderBars(block, open && ((index) => open(block, index))));
		} else if (block.kind === "table") {
			if (block.note) card.append(element("p", "statly-note statly-period", block.note));
			card.append(renderTable(block, Math.max(1, cells.h - 2)));
		} else card.append(renderHeatmap(block));
		if (open) card.addEventListener("click", () => open(block));
		return card;
	}
	function factRow(label, value) {
		const row = element("div", "statly-fact");
		row.append(element("span", "", label), element("strong", "", value));
		return row;
	}
	function percent(value) {
		return `${Math.round(value * 100)} %`;
	}
	function signedPercent(value) {
		return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))} %`;
	}
	/** What one bar means next to all the others. */
	function barFacts(block, selected, words) {
		const box = element("div", "statly-facts");
		const bar = block.bars[selected];
		const total = block.bars.reduce((sum, item) => sum + item.value, 0);
		const average = total / Math.max(1, block.bars.length);
		if (bar) {
			box.append(element("h3", "statly-selected", `${bar.label}: ${bar.value.toLocaleString()}`));
			box.append(factRow(words.share, percent(total ? bar.value / total : 0)));
			box.append(factRow(words.comparedTo, signedPercent(average ? bar.value / average - 1 : 0)));
		}
		return box;
	}
	function barSummary(block, words) {
		const box = element("div", "statly-facts");
		const total = block.bars.reduce((sum, item) => sum + item.value, 0);
		const best = block.bars.reduce((top, item) => top && top.value >= item.value ? top : item, void 0);
		box.append(factRow(words.total, total.toLocaleString()));
		box.append(factRow(words.average, (total / Math.max(1, block.bars.length)).toLocaleString(void 0, { maximumFractionDigits: 1 })));
		if (best) box.append(factRow(words.best, `${best.label}: ${best.value.toLocaleString()}`));
		return box;
	}
	function highlightBar(chart, selected) {
		chart.querySelectorAll(".statly-bar").forEach((bar, index) => {
			bar.classList.toggle("statly-bar-dim", index !== selected);
		});
	}
	function sheetBody(block, selected, words) {
		const body = document.createElement("div");
		if (block.kind === "tile") {
			body.append(element("div", "statly-value statly-sheet-value", block.value));
			const facts = element("div", "statly-facts");
			facts.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
			body.append(facts);
		} else if (block.kind === "table") {
			body.append(renderTable(block));
			const facts = element("div", "statly-facts");
			facts.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
			body.append(facts);
		} else if (block.kind === "heatmap") {
			body.append(heatGrid(block.levels, block.label));
			const facts = element("div", "statly-facts");
			facts.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
			body.append(facts);
		} else {
			const details = barFacts(block, selected, words);
			const redraw = (index) => {
				details.replaceChildren(...barFacts(block, index, words).childNodes);
				highlightBar(body, index);
			};
			const chart = element("div", "statly-sheet-chart");
			chart.append(renderBars({
				...block,
				horizontal: false
			}, redraw));
			const list = rows(block.bars, redraw);
			const extra = element("div", "statly-facts");
			extra.append(...block.facts.map((fact) => factRow(fact.label, fact.value)));
			body.append(chart, details, barSummary(block, words), extra, list);
			highlightBar(body, selected);
		}
		return body;
	}
	/** A closer look at one block, on the whole screen. */
	function openSheet(root, block, selected, words) {
		if (block.kind === "custom") return;
		const sheet = element("section", "statly-sheet");
		const back = element("button", "statly-back", `‹ ${words.back}`);
		back.setAttribute("type", "button");
		back.addEventListener("click", () => sheet.remove());
		sheet.append(back, element("h2", "statly-title", block.label));
		if (block.note) sheet.append(element("p", "statly-note", block.note));
		sheet.append(sheetBody(block, selected, words));
		root.append(sheet);
	}
	function deviceFor(width) {
		return width >= TABLET_FROM_PX ? "tablet" : "phone";
	}
	function draw(root, snapshot, device) {
		root.textContent = "";
		const background = snapshot.backgrounds[device];
		const page = root.parentElement;
		if (page) {
			page.style.backgroundImage = background ? `url("${background}")` : "";
			page.classList.toggle("statly-has-background", Boolean(background));
		}
		const header = element("header", "statly-header");
		header.append(element("h1", "statly-title", snapshot.title), element("p", "statly-note", snapshot.updated));
		const grid = element("div", "statly-grid");
		grid.style.setProperty("--statly-columns", String(COLUMNS[device]));
		for (const { block: key, x, y, w, h } of snapshot[device]) {
			const block = snapshot.blocks[key];
			if (block) {
				const cell = document.createElement("div");
				cell.className = "statly-cell";
				cell.style.gridColumn = `${x + 1} / span ${w}`;
				cell.style.gridRow = `${y + 1} / span ${h}`;
				cell.append(renderBlock(block, {
					w,
					h
				}, snapshot.words, (chosen, selected = 0) => openSheet(root, chosen, selected, snapshot.words)));
				grid.append(cell);
			}
		}
		root.append(header, grid, element("p", "statly-hint", snapshot.hint));
	}
	/** Phones and tablets each get their layout, and turning a device can change which one fits. */
	function render(root, snapshot) {
		let device = deviceFor(root.clientWidth);
		draw(root, snapshot, device);
		addEventListener("resize", () => {
			const next = deviceFor(root.clientWidth);
			if (next !== device) {
				device = next;
				draw(root, snapshot, device);
			}
		});
	}
	function decode(encoded) {
		const bytes = Uint8Array.from(atob(encoded.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes));
	}
	// src/main.ts
	var REPAIR_NOTE = navigator.language.startsWith("de") ? "Diese Karte wurde verändert. Öffne Anki auf deinem Computer und synchronisiere: Sie repariert sich dann von selbst." : "This card was changed. Open Anki on your computer and sync: it repairs itself then.";
	var root = document.getElementById("statly-root");
	var data = document.getElementById("statly-data");
	if (root) try {
		render(root, decode(data?.textContent ?? ""));
	} catch {
		root.textContent = REPAIR_NOTE;
	}
})();
