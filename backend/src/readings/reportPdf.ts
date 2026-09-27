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

const PAGE_WIDTH = 841.89; // A4 landscape, PDF points
const PAGE_HEIGHT = 595.28;
const BUCKETS = 120;

type Metric = { buckets: (number | null)[]; min: number; max: number; latest: number | null };
type SensorPlot = { sensor: ReportSensor; temperature: Metric; temperature2: Metric; humidity: Metric; readings: number };

function metric(): Metric { return { buckets: Array<number | null>(BUCKETS).fill(null), min: Infinity, max: -Infinity, latest: null }; }
function updateMetric(target: Metric, value: number | null, bucket: number): void {
  if (value === null || !Number.isFinite(value)) return;
  target.buckets[bucket] = value;
  target.min = Math.min(target.min, value);
  target.max = Math.max(target.max, value);
  target.latest = value;
}

function printable(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfPage(commands: string[]): Buffer {
  const stream = Buffer.from(commands.join('\n') + '\n', 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString('ascii')}endstream`,
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let size = parts[0].length;
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(size);
    const part = Buffer.from(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`, 'ascii');
    parts.push(part);
    size += part.length;
  }
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ', ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(parts);
}

function chartColumns(count: number): number {
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  if (count <= 30) return 5;
  if (count <= 48) return 6;
  if (count <= 72) return 8;
  return 10;
}

export async function buildSensorReport(source: ReportSource, sensors: ReportSensor[], from: Date, to: Date): Promise<Buffer> {
  if (!sensors.length) throw new Error('No active sensors are configured');
  if (!(from < to)) throw new Error('End time must be after start time');
  const plots = new Map(sensors.map((sensor) => [sensor.id, { sensor, temperature: metric(), temperature2: metric(), humidity: metric(), readings: 0 } satisfies SensorPlot]));
  const duration = to.getTime() - from.getTime();
  for await (const row of source.scan(from, to, sensors.map((sensor) => sensor.id))) {
    const plot = plots.get(row.sensorId);
    if (!plot) continue;
    const bucket = Math.max(0, Math.min(BUCKETS - 1, Math.floor((row.receivedAt.getTime() - from.getTime()) / duration * BUCKETS)));
    updateMetric(plot.temperature, row.temperature, bucket);
    updateMetric(plot.temperature2, row.temperature2, bucket);
    updateMetric(plot.humidity, row.humidity, bucket);
    plot.readings += 1;
  }

  const commands: string[] = [];
  const text = (x: number, y: number, size: number, value: string, color = '0.08 0.16 0.23') => {
    commands.push(`BT /F1 ${size.toFixed(2)} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${printable(value)}) Tj ET`);
  };
  const rectangle = (x: number, y: number, width: number, height: number, fill: string, stroke?: string) => {
    commands.push(`${fill} rg ${stroke ?? fill} RG 0.55 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${stroke ? 'B' : 'f'}`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width = 0.9) => {
    commands.push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };

  rectangle(0, PAGE_HEIGHT - 66, PAGE_WIDTH, 66, '0.04 0.13 0.23');
  text(28, PAGE_HEIGHT - 31, 19, 'TEMPMO  |  SENSOR TRENDS', '1 1 1');
  text(28, PAGE_HEIGHT - 50, 8.5, `${sensors.length} active sensor${sensors.length === 1 ? '' : 's'}  |  ${from.toISOString().slice(0, 16).replace('T', ' ')} to ${to.toISOString().slice(0, 16).replace('T', ' ')} UTC`, '0.72 0.87 0.90');

  const ordered = sensors.map((sensor) => plots.get(sensor.id)!);
  const columns = chartColumns(ordered.length);
  const rows = Math.ceil(ordered.length / columns);
  const gap = ordered.length > 48 ? 4 : 8;
  const left = 28;
  const top = PAGE_HEIGHT - 79;
  const bottom = 30;
  const cellWidth = (PAGE_WIDTH - 56 - gap * (columns - 1)) / columns;
  const cellHeight = (top - bottom - gap * (rows - 1)) / rows;
  const fontSize = cellHeight < 55 ? 6.2 : cellHeight < 85 ? 8 : 10;

  ordered.forEach((plot, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = left + column * (cellWidth + gap);
    const y = top - (row + 1) * cellHeight - row * gap;
    rectangle(x, y, cellWidth, cellHeight, '0.985 0.99 0.99', '0.79 0.85 0.88');
    const maxName = Math.max(3, Math.floor((cellWidth - 18) / (fontSize * 0.53)));
    const label = `${plot.sensor.name} (${plot.sensor.id})`;
    text(x + 7, y + cellHeight - fontSize - 5, fontSize, label.length > maxName ? `${label.slice(0, maxName - 2)}..` : label);
    const chartX = x + 8;
    const chartY = y + (cellHeight < 55 ? 12 : 18);
    const chartWidth = cellWidth - 16;
    const chartHeight = Math.max(8, cellHeight - (cellHeight < 55 ? 27 : 39));
    line(chartX, chartY, chartX + chartWidth, chartY, '0.83 0.88 0.90', 0.5);
    line(chartX, chartY + chartHeight, chartX + chartWidth, chartY + chartHeight, '0.91 0.94 0.95', 0.5);

    const drawMetric = (series: Metric, color: string, sharedMin?: number, sharedMax?: number) => {
      if (series.latest === null) return;
      const minimum = sharedMin ?? series.min;
      const maximum = sharedMax ?? series.max;
      const spread = Math.max(maximum - minimum, 0.1);
      let previous: { x: number; y: number } | null = null;
      series.buckets.forEach((value, bucket) => {
        if (value === null) return;
        const point = { x: chartX + bucket / (BUCKETS - 1) * chartWidth, y: chartY + 2 + (value - minimum) / spread * (chartHeight - 4) };
        if (previous) line(previous.x, previous.y, point.x, point.y, color, cellHeight < 55 ? 0.65 : 1.1);
        else rectangle(point.x - 1, point.y - 1, 2, 2, color);
        previous = point;
      });
    };
    const temperatureMin = Math.min(plot.temperature.min, plot.temperature2.min);
    const temperatureMax = Math.max(plot.temperature.max, plot.temperature2.max);
    if (Number.isFinite(temperatureMin)) {
      drawMetric(plot.temperature, '0.00 0.48 0.44', temperatureMin, temperatureMax);
      drawMetric(plot.temperature2, '0.11 0.64 0.70', temperatureMin, temperatureMax);
    }
    drawMetric(plot.humidity, '0.31 0.40 0.78');
    const values = [plot.temperature.latest === null ? null : `T ${plot.temperature.latest.toFixed(1)}C`, plot.temperature2.latest === null ? null : `T2 ${plot.temperature2.latest.toFixed(1)}C`, plot.humidity.latest === null ? null : `H ${plot.humidity.latest.toFixed(1)}%`].filter(Boolean).join('  ');
    const summary = plot.readings ? values || `${plot.readings} saved readings` : 'No readings in this period';
    const maxSummary = Math.max(5, Math.floor((cellWidth - 14) / (Math.max(5.5, fontSize - 1) * 0.53)));
    text(x + 7, y + 5, Math.max(5.5, fontSize - 1), summary.length > maxSummary ? `${summary.slice(0, maxSummary - 2)}..` : summary, '0.31 0.39 0.46');
  });

  text(28, 15, 7, 'Temperature: teal  |  Second temperature: cyan  |  Humidity: blue. Each metric is scaled to show its trend.', '0.37 0.43 0.49');
  text(PAGE_WIDTH - 78, 15, 7, 'A4 LANDSCAPE', '0.37 0.43 0.49');
  return pdfPage(commands);
}
