import net from 'node:net';

// Behaves like a G7 Base Station: connects to Node's TCP listener and sends frames.
// Modes: normal | high-temp | low-temp | high-humidity | low-battery | dropout | malformed | partial
const HOST = process.env.G7_TEST_HOST ?? '127.0.0.1';
const PORT = Number(process.env.G7_TEST_PORT ?? 6900);
const MODE = process.env.SIM_MODE ?? 'normal';
const SENSOR = process.env.SIM_SENSOR ?? '02';

const base = '#STA:000000,111;L:381;TM:260916214100;A01:26.56;A02:27.12;A03:0.000;A04:0.000;A05:27.32;A06:0.000;A07:0.000;A08:0.000;H01:0.000;H02:73.83;H03:0.000;H04:0.000;H05:27.13;H06:0.000;H07:0.000;H08:0.000;B01:3.670;B02:3.660;B03:0.000;B04:0.000;B05:3.630;B06:0.000;B07:0.000;B08:0.000;K01:03000000;K02:03010100;K03:00000000;K04:00000000;K05:03000700;K06:00000000;K07:00000000;K08:00000000;EE;#';

function mutate(frame: string): string {
  switch (MODE) {
    case 'high-temp': return frame.replace(`A${SENSOR}:`, `A${SENSOR}:`).replace(/A02:27\.12/, 'A02:35.42');
    case 'low-temp': return frame.replace(/A02:27\.12/, 'A02:2.10');
    case 'high-humidity': return frame.replace(/H02:73\.83/, 'H02:95.10');
    case 'low-battery': return frame.replace(/B02:3\.660/, 'B02:3.05');
    case 'malformed': return '#STA:GARBAGE-NO-END';
    default: return frame;
  }
}

const sock = net.connect(PORT, HOST, () => {
  console.log(`simulator connected to ${HOST}:${PORT} mode=${MODE}`);
  if (MODE === 'dropout') {
    sock.write(mutate(base));
    console.log('sent one frame then going silent (dropout test)');
    return; // stay connected but silent
  }
  const send = () => {
    const frame = mutate(base);
    if (MODE === 'partial') {
      const half = Math.floor(frame.length / 2);
      sock.write(frame.slice(0, half));
      setTimeout(() => sock.write(frame.slice(half)), 100);
    } else if (MODE === 'multi') {
      sock.write(frame + frame); // two messages in one TCP read
    } else {
      sock.write(frame);
    }
  };
  send();
  const t = setInterval(send, 2000);
  sock.on('close', () => clearInterval(t));
});
sock.on('error', (e) => {
  console.error('simulator error:', e.message);
  process.exit(1);
});
