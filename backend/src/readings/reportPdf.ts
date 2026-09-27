type ReportReading = {
  sensorId: string;
  receivedAt: Date;
  temperature: number | null;
  temperature2: number | null;
  humidity: number | null;
};

export type ReportSource = {
  scan(from: Date, to: Date, sensorIds: string[]): AsyncGenerator<ReportReading>;
};

export type ReportSensor = { id: string; name: string };
export type ReportOptions = { timeZone?: string; generatedAt?: Date };

const PAGE_WIDTH = 841.89; // A4 landscape, PDF points
const PAGE_HEIGHT = 595.28;
const BUCKETS = 240;
const NAVY = '0.04 0.13 0.23';
const MUTED = '0.36 0.44 0.51';
const BORDER = '0.83 0.88 0.91';
const TEAL = '0.00 0.48 0.44';
const CYAN = '0.08 0.62 0.72';
const BLUE = '0.29 0.39 0.76';

type Bucket = { min: number; max: number; sum: number; count: number };
type Metric = { buckets: (Bucket | null)[]; min: number; max: number; sum: number; count: number; latest: number | null; latestAt: number };
type SensorPlot = {
  sensor: ReportSensor;
  readings: number;
  first: Date | null;
  last: Date | null;
  temperature: Metric;
  temperature2: Metric;
  humidity: Metric;
};

function metric(): Metric {
  return { buckets: Array<Bucket | null>(BUCKETS).fill(null), min: Infinity, max: -Infinity, sum: 0, count: 0, latest: null, latestAt: -Infinity };
}

function updateMetric(target: Metric, value: number | null, at: number, bucket: number): void {
  if (value === null || !Number.isFinite(value)) return;
  const sample = target.buckets[bucket] ?? { min: Infinity, max: -Infinity, sum: 0, count: 0 };
  sample.min = Math.min(sample.min, value);
  sample.max = Math.max(sample.max, value);
  sample.sum += value;
  sample.count += 1;
  target.buckets[bucket] = sample;
  target.min = Math.min(target.min, value);
  target.max = Math.max(target.max, value);
  target.sum += value;
  target.count += 1;
  if (at >= target.latestAt) { target.latest = value; target.latestAt = at; }
}

function printable(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e°]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/°/g, '\\260');
}

class Page {
  commands: string[] = [];

  text(x: number, y: number, size: number, value: string, color = NAVY): void {
    this.commands.push(`BT /F1 ${size.toFixed(2)} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${printable(value)}) Tj ET`);
  }

  rectangle(x: number, y: number, width: number, height: number, fill: string, stroke?: string): void {
    this.commands.push(`${fill} rg ${stroke ?? fill} RG 0.55 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${stroke ? 'B' : 'f'}`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.9): void {
    this.commands.push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
}

function pdfDocument(pages: Page[]): Buffer {
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  const objects: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  for (let index = 0; index < pages.length; index += 1) {
    const contentId = 5 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = Buffer.from(pages[index].commands.join('\n') + '\n', 'ascii');
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'), stream, Buffer.from('endstream', 'ascii')]));
  }
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), typeof object === 'string' ? Buffer.from(object, 'ascii') : object, Buffer.from('\nendobj\n', 'ascii')]);
    parts.push(part);
    size += part.length;
  });
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(parts);
}

function formatDate(value: Date, timeZone: string, includeSeconds = false): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}), hourCycle: 'h23' })
    .format(value).replace(/,/g, '').replace(/[\u00a0\u202f]/g, ' ');
}

function formatMetric(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(1)}${unit}`;
}

function metricStats(value: Metric, unit: string): [string, string] {
  if (!value.count) return ['No readings', ''];
  return [
    `Min ${formatMetric(value.min, unit)}   Avg ${formatMetric(value.sum / value.count, unit)}`,
    `Max ${formatMetric(value.max, unit)}   Last ${formatMetric(value.latest, unit)}`,
  ];
}

function lines(value: string, maxChars: number, maxLines: number): string[] {
  const result: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (current && `${current} ${word}`.length > maxChars) { result.push(current); current = ''; }
    if (word.length > maxChars) {
      for (let start = 0; start < word.length; start += maxChars) result.push(word.slice(start, start + maxChars));
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) result.push(current);
  if (result.length <= maxLines) return result;
  return [...result.slice(0, maxLines - 1), `${result.slice(maxLines - 1).join(' ').slice(0, maxChars - 2)}..`];
}

function header(page: Page, title: string, from: Date, to: Date, timeZone: string): void {
  page.rectangle(0, PAGE_HEIGHT - 82, PAGE_WIDTH, 82, NAVY);
  page.text(30, PAGE_HEIGHT - 32, 18, `TEMPMO  |  ${title}`, '1 1 1');
  page.text(30, PAGE_HEIGHT - 54, 9, `${formatDate(from, timeZone)} to ${formatDate(to, timeZone)}`, '0.80 0.90 0.94');
  page.text(30, PAGE_HEIGHT - 70, 8, `Time zone: ${timeZone}`, '0.80 0.90 0.94');
}

function footer(page: Page, pageNumber: number, pageCount: number, generatedAt: Date, timeZone: string): void {
  page.line(30, 38, PAGE_WIDTH - 30, 38, BORDER, 0.5);
  page.text(30, 24, 7.5, `Generated ${formatDate(generatedAt, timeZone)}  |  A4 landscape`, MUTED);
  page.text(PAGE_WIDTH - 95, 24, 7.5, `Page ${pageNumber} of ${pageCount}`, MUTED);
}

const SUMMARY_ROWS = 9;
const TABLE_LEFT = 30;
const TABLE_RIGHT = PAGE_WIDTH - 30;
const TABLE_TOP = 430;
const ROW_HEIGHT = 42;
const COLUMNS = [30, 166, 220, 378, 533, 678, TABLE_RIGHT];

function summaryPages(plots: SensorPlot[], from: Date, to: Date, timeZone: string): Page[] {
  const pages: Page[] = [];
  for (let offset = 0; offset < plots.length; offset += SUMMARY_ROWS) {
    const page = new Page();
    header(page, 'SENSOR SUMMARY', from, to, timeZone);
    page.text(30, 487, 12, `Selected sensors: ${plots.length}`, NAVY);
    page.text(30, 470, 8.5, 'Values summarize saved readings within the selected time period.', MUTED);
    page.rectangle(TABLE_LEFT, TABLE_TOP, TABLE_RIGHT - TABLE_LEFT, 24, '0.91 0.95 0.96');
    ['Sensor', 'Readings', 'First / last reading', 'Temperature (°C)', 'Second temp (°C)', 'Humidity (%)']
      .forEach((label, index) => page.text(COLUMNS[index] + 6, TABLE_TOP + 8, 8, label, NAVY));

    plots.slice(offset, offset + SUMMARY_ROWS).forEach((plot, index) => {
      const top = TABLE_TOP - index * ROW_HEIGHT;
      page.rectangle(TABLE_LEFT, top - ROW_HEIGHT, TABLE_RIGHT - TABLE_LEFT, ROW_HEIGHT, index % 2 ? '0.975 0.985 0.987' : '1 1 1');
      page.line(TABLE_LEFT, top - ROW_HEIGHT, TABLE_RIGHT, top - ROW_HEIGHT, BORDER, 0.4);
      lines(plot.sensor.name, 27, 3).forEach((nameLine, lineIndex) => page.text(COLUMNS[0] + 6, top - 14 - lineIndex * 10, 8, nameLine));
      page.text(COLUMNS[1] + 6, top - 20, 8, plot.readings.toLocaleString('en-GB'));
      if (plot.first && plot.last) {
        page.text(COLUMNS[2] + 6, top - 14, 7.3, formatDate(plot.first, timeZone, true));
        page.text(COLUMNS[2] + 6, top - 28, 7.3, formatDate(plot.last, timeZone, true));
      } else page.text(COLUMNS[2] + 6, top - 20, 8, 'No readings', MUTED);
      [plot.temperature, plot.temperature2, plot.humidity].forEach((value, metricIndex) => {
        const [first, second] = metricStats(value, metricIndex === 2 ? '%' : '°C');
        page.text(COLUMNS[metricIndex + 3] + 6, top - 14, 7.3, first, value.count ? NAVY : MUTED);
        if (second) page.text(COLUMNS[metricIndex + 3] + 6, top - 28, 7.3, second);
      });
    });
    pages.push(page);
  }
  return pages;
}

type ChartSeries = { label: string; metric: Metric; color: string };

function chartPanel(page: Page, x: number, y: number, width: number, height: number, title: string, series: ChartSeries[], from: Date, to: Date, timeZone: string, unit: string): void {
  page.rectangle(x, y, width, height, '0.99 0.995 0.995', BORDER);
  page.text(x + 14, y + height - 23, 11, title);
  series.forEach((item, index) => {
    const legendX = x + width - 165 + (index % 2) * 90;
    const legendY = y + height - 21 - Math.floor(index / 2) * 11;
    page.line(legendX, legendY + 2, legendX + 11, legendY + 2, item.color, 2);
    page.text(legendX + 15, legendY, 7, item.label, MUTED);
  });
  const available = series.filter((item) => item.metric.count > 0);
  if (!available.length) {
    page.text(x + width / 2 - 93, y + height / 2, 10, `No ${unit === '%' ? 'humidity' : 'temperature'} readings in this period`, MUTED);
    return;
  }

  const chartX = x + 54;
  const chartY = y + 36;
  const chartWidth = width - 75;
  const chartHeight = height - 77;
  const minimum = Math.min(...available.map((item) => item.metric.min));
  const maximum = Math.max(...available.map((item) => item.metric.max));
  const padding = Math.max((maximum - minimum) * 0.06, unit === '%' ? 0.5 : 0.2);
  const low = minimum - padding;
  const high = maximum + padding;
  const positionY = (value: number) => chartY + (value - low) / (high - low) * chartHeight;
  for (let tick = 0; tick <= 2; tick += 1) {
    const at = chartY + tick * chartHeight / 2;
    page.line(chartX, at, chartX + chartWidth, at, '0.88 0.91 0.93', 0.5);
    page.text(x + 7, at - 3, 7.2, `${(low + tick * (high - low) / 2).toFixed(1)}${unit}`, MUTED);
  }
  for (let tick = 0; tick <= 4; tick += 1) {
    const at = chartX + tick * chartWidth / 4;
    page.line(at, chartY, at, chartY - 3, BORDER, 0.5);
    const date = new Date(from.getTime() + tick * (to.getTime() - from.getTime()) / 4);
    page.text(Math.max(x + 5, Math.min(at - 34, x + width - 91)), y + 13, 6.9, formatDate(date, timeZone), MUTED);
  }

  available.forEach((item) => {
    let previous: { bucket: number; x: number; y: number } | null = null;
    item.metric.buckets.forEach((bucket, index) => {
      if (!bucket) { previous = null; return; }
      const at = chartX + (index + 0.5) / BUCKETS * chartWidth;
      const center = positionY(bucket.sum / bucket.count);
      // The vertical range retains short peaks and dips after downsampling.
      page.line(at, positionY(bucket.min), at, positionY(bucket.max), item.color, 1.1);
      if (previous && previous.bucket === index - 1) page.line(previous.x, previous.y, at, center, item.color, 1.5);
      else page.rectangle(at - 1, center - 1, 2, 2, item.color);
      previous = { bucket: index, x: at, y: center };
    });
  });
}

function chartPage(plot: SensorPlot, from: Date, to: Date, timeZone: string): Page {
  const page = new Page();
  header(page, 'SENSOR CHARTS', from, to, timeZone);
  lines(plot.sensor.name, 70, 2).forEach((nameLine, index) => page.text(30, 488 - index * 15, 14, nameLine));
  page.text(30, 455, 8.2, `${plot.readings.toLocaleString('en-GB')} readings  |  First: ${plot.first ? formatDate(plot.first, timeZone, true) : 'none'}  |  Last: ${plot.last ? formatDate(plot.last, timeZone, true) : 'none'}`, MUTED);
  chartPanel(page, 30, 251, PAGE_WIDTH - 60, 190, 'Temperature (°C)', [
    { label: 'Temperature', metric: plot.temperature, color: TEAL },
    { label: 'Second temperature', metric: plot.temperature2, color: CYAN },
  ], from, to, timeZone, '°C');
  chartPanel(page, 30, 51, PAGE_WIDTH - 60, 190, 'Humidity (%)', [
    { label: 'Humidity', metric: plot.humidity, color: BLUE },
  ], from, to, timeZone, '%');
  return page;
}

export async function buildSensorReport(source: ReportSource, sensors: ReportSensor[], from: Date, to: Date, options: ReportOptions = {}): Promise<Buffer> {
  if (!sensors.length) throw new Error('No sensors are configured');
  if (!(from < to)) throw new Error('End time must be after start time');
  const timeZone = options.timeZone ?? 'UTC';
  new Intl.DateTimeFormat('en-GB', { timeZone }); // Reject invalid time zones before scanning.
  const plots = new Map<string, SensorPlot>(sensors.map((sensor) => [sensor.id, {
    sensor, readings: 0, first: null, last: null, temperature: metric(), temperature2: metric(), humidity: metric(),
  } satisfies SensorPlot]));
  const duration = to.getTime() - from.getTime();
  for await (const row of source.scan(from, to, sensors.map((sensor) => sensor.id))) {
    const plot = plots.get(row.sensorId);
    const at = row.receivedAt.getTime();
    if (!plot || !Number.isFinite(at) || at < from.getTime() || at >= to.getTime()) continue;
    const bucket = Math.min(BUCKETS - 1, Math.floor((at - from.getTime()) / duration * BUCKETS));
    updateMetric(plot.temperature, row.temperature, at, bucket);
    updateMetric(plot.temperature2, row.temperature2, at, bucket);
    updateMetric(plot.humidity, row.humidity, at, bucket);
    plot.readings += 1;
    if (!plot.first || row.receivedAt < plot.first) plot.first = row.receivedAt;
    if (!plot.last || row.receivedAt > plot.last) plot.last = row.receivedAt;
  }
  const ordered = sensors.map((sensor) => plots.get(sensor.id)!);
  const pages = [...summaryPages(ordered, from, to, timeZone), ...ordered.map((plot) => chartPage(plot, from, to, timeZone))];
  const generatedAt = options.generatedAt ?? new Date();
  pages.forEach((page, index) => footer(page, index + 1, pages.length, generatedAt, timeZone));
  return pdfDocument(pages);
}
