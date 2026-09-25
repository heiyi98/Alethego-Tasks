import { nextOccurrence } from '@alethego/core';
export const dynamic = 'force-dynamic';
export default function HomePage() {
  const n = nextOccurrence(
    { rule: 'FREQ=DAILY', dtstart: new Date('2026-01-01T00:00:00Z') },
    new Date('2026-09-25T12:00:00Z'),
    'Asia/Shanghai',
  );
  return <p id="n">{n?.toISOString()}</p>;
}
