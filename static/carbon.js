(() => {
  "use strict";

  const CHART_ID = "carbonChart";
  let chartInstance;
  const BAR_GAP = 0.5;
  const MIN_BAR_WIDTH = 6;

  const colourStops = [
    { stop: 0.0, rgb: [244, 63, 94] },   // red
    { stop: 0.25, rgb: [255, 140, 0] },  // orange
    { stop: 0.5, rgb: [255, 200, 0] },   // yellow
    { stop: 0.75, rgb: [144, 238, 144] },// light green
    { stop: 1.0, rgb: [34, 139, 34] }    // dark green
  ];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function interpolateColour(value) {
    const clamped = Math.min(Math.max(value, 0), 1);
    let start = colourStops[0];
    let end = colourStops[colourStops.length - 1];

    for (let i = 0; i < colourStops.length - 1; i += 1) {
      const current = colourStops[i];
      const next = colourStops[i + 1];
      if (clamped >= current.stop && clamped <= next.stop) {
        start = current;
        end = next;
        break;
      }
    }

    const range = end.stop - start.stop || 1;
    const t = (clamped - start.stop) / range;
    const r = Math.round(lerp(start.rgb[0], end.rgb[0], t));
    const g = Math.round(lerp(start.rgb[1], end.rgb[1], t));
    const b = Math.round(lerp(start.rgb[2], end.rgb[2], t));
    return { r, g, b };
  }

  function applyGrayTint({ r, g, b }, factor = 0.65) {
    const gray = 128;
    return {
      r: Math.round(r * (1 - factor) + gray * factor),
      g: Math.round(g * (1 - factor) + gray * factor),
      b: Math.round(b * (1 - factor) + gray * factor)
    };
  }

  function rgba({ r, g, b }, alpha = 1) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function buildHourAggregation(rawPeriods) {
    const hourly = [];
    const order = ["very low", "low", "moderate", "high", "very high"];

    for (let i = 0; i < rawPeriods.length; i += 2) {
      const periodA = rawPeriods[i];
      const periodB = rawPeriods[i + 1];
      if (!periodA || !periodB) break;

      const avgForecast = (periodA.intensity.forecast + periodB.intensity.forecast) / 2;
      const indexA = (periodA.intensity.index || "").toLowerCase();
      const indexB = (periodB.intensity.index || "").toLowerCase();
      const ordA = order.indexOf(indexA);
      const ordB = order.indexOf(indexB);

      let chosenIndex = periodA.intensity.index || periodB.intensity.index || "";
      if (ordA >= 0 && ordB >= 0) {
        chosenIndex = ordB > ordA ? periodB.intensity.index : periodA.intensity.index;
      }

      hourly.push({
        from: periodA.from,
        to: periodB.to,
        intensity: {
          forecast: avgForecast,
          index: chosenIndex
        }
      });
    }

    return hourly;
  }

  function buildChartData(periods) {
    if (!periods.length) {
      return { labels: [], data: [], bars: [], borders: [], meta: {} };
    }

    const currentTime = new Date();
    const maxForecast = Math.max(...periods.map((p) => p.intensity.forecast));

  const labels = [];
  const labelPattern = ["Midnight", "6AM", "Midday", "6PM"];
    const data = [];
    const bars = [];
    const borders = [];

    let midnightIndex = -1;
    const noonIndices = [];
    const startIndex = 0;
    const endIndex = periods.length - 1;

    periods.forEach((period, index) => {
      const periodStart = new Date(period.from);
      const periodEnd = new Date(period.to);
      const hour = Number(new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London",hour:"numeric",hourCycle:"h23"}).format(periodStart));
      const mins = periodStart.getMinutes();

      let label = "";
      const labelIndex = Math.floor(index / 6);
      if (index % 6 === 0) {
        label = labelPattern[labelIndex % labelPattern.length];
      }
      labels.push(label);

      if (index > 0) {
        const prevStart = new Date(periods[index - 1].from);
        if (prevStart.toLocaleDateString("en-GB",{timeZone:"Europe/London"}) !== periodStart.toLocaleDateString("en-GB",{timeZone:"Europe/London"})) {
          midnightIndex = index;
        }
      }

      if (hour === 12 && mins === 0) {
        noonIndices.push(index);
      }

      const cleanliness = maxForecast ? 1 - period.intensity.forecast / maxForecast : 1;
      data.push(cleanliness);

      let baseColour = interpolateColour(cleanliness);
      let alpha = 1;

      const isCurrent = currentTime >= periodStart && currentTime < periodEnd;
      const isPast = !isCurrent && periodEnd <= currentTime;

      if (isPast) {
        baseColour = applyGrayTint(baseColour);
        alpha = 0.75;
      }

      bars.push(rgba(baseColour, alpha));
      borders.push(isCurrent ? "rgba(59, 130, 246, 1)" : "transparent");
    });

    return {
      labels,
      data,
      bars,
      borders,
      meta: { startIndex, endIndex, midnightIndex, noonIndices }
    };
  }

  async function fetchCarbonData() {
    const response = await fetch("/api/carbon");
    const json = await response.json();
    window.tileState(json);
    if (!response.ok || !json.data) throw new Error("Unavailable");
    return buildHourAggregation(json.data);
  }

  function drawCarbonChart(periods) {
    const canvas = document.getElementById(CHART_ID);
    if (!canvas || !periods.length || typeof Chart === "undefined") return;

    const { labels, data, bars, borders, meta } = buildChartData(periods);
    const ctx = canvas.getContext("2d");

    const threshold = 0.66;

    const verticalLinesPlugin = {
      id: "carbonThresholds",
      afterDraw(chart) {
        const { ctx: context, scales } = chart;
        const yScale = scales.y;
        const xScale = scales.x;
        if (!yScale || !xScale) return;

        const yPos = yScale.getPixelForValue(threshold);
        context.save();
        context.strokeStyle = "rgba(255, 255, 255, 0.45)";
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.beginPath();
        context.moveTo(xScale.left, yPos);
        context.lineTo(xScale.right, yPos);
        context.stroke();
        context.restore();

        const drawVertical = (indices, dash) => {
          context.save();
          context.strokeStyle = "rgba(160, 160, 160, 0.5)";
          context.lineWidth = 1;
          context.setLineDash(dash);
          indices.forEach((index) => {
            if (index < 0) return;
            const xPos = xScale.getPixelForValue(index);
            context.beginPath();
            context.moveTo(xPos, yScale.top);
            context.lineTo(xPos, yScale.bottom);
            context.stroke();
          });
          context.restore();
        };

        drawVertical([meta.startIndex, meta.endIndex, meta.midnightIndex], []);
        drawVertical(meta.noonIndices, [3, 3]);
      }
    };

    const fixedGapPlugin = {
      id: "fixedBarGap",
      afterLayout(chart) {
        const dataset = chart.data.datasets?.[0];
        if (!dataset || !chart.chartArea) return;
        const count = dataset.data?.length ?? 0;
        if (!count) return;
        const width = chart.chartArea.width;
        const categoryWidth = width / count;
        const thickness = Math.max(1, categoryWidth - BAR_GAP);
        dataset.barThickness = thickness;
        dataset.maxBarThickness = thickness;
      }
    };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Cleanliness",
            data,
            backgroundColor: bars,
            borderColor: borders,
            borderWidth: borders.map(c => c === "transparent" ? 0 : 3),
            borderRadius: 10,
            borderSkipped: false,
            barThickness: undefined,
            maxBarThickness: undefined
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            categoryPercentage: 1.0,
            barPercentage: 1.0,
            offset: false,
            grid: { display: false },
            ticks: {
              color: "rgba(255,255,255,0.75)",
              maxRotation: 0,
              autoSkip: false,
              callback(value, index, ticks) {
                const label = (this?.chart?.data?.labels ?? [])[index];
                return this.chart.width < 500 && index % 12 !== 0 ? "" : label || "";
              },
              font: {
                family: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                size: 11
              }
            }
          },
          y: {
            display: false,
            min: 0,
            max: 1
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 15, 25, 0.85)",
            borderColor: "rgba(255, 255, 255, 0.15)",
            borderWidth: 1,
            titleFont: {
              family: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              size: 12,
              weight: 600
            },
            bodyFont: {
              family: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              size: 12
            },
            callbacks: {
              label(context) {
                const original = periods[context.dataIndex]?.intensity?.forecast ?? "?";
                const index = periods[context.dataIndex]?.intensity?.index ?? "Unknown";
                return `${original} gCO₂/kWh (${index})`;
              }
            }
          }
        }
      },
      plugins: [verticalLinesPlugin, fixedGapPlugin]
    });
  }

  async function initCarbonChart() {
    try {
      const periods = await fetchCarbonData();
      if (periods.length) {
        drawCarbonChart(periods);
      }
    } catch (error) {
      window.tileState({state: "unavailable", data: null});
      const panel = document.querySelector(".carbon-panel .muted");
      if (panel) {
        panel.textContent = "Carbon intensity data unavailable";
      }
    }
  }

  setInterval(initCarbonChart, 30000);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarbonChart);
  } else {
    initCarbonChart();
  }
})();


