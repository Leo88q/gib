import { NextResponse } from 'next/server';
import { checkAdminToken } from '@/lib/admin/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import {
  buildDatasetRows,
  buildXapiStatements,
  loadAnalyticsSourceData,
  rowsToCsv,
  type ResearchDatasetKind,
  type ResearchExportFormat,
} from '@/lib/research/export';

export const dynamic = 'force-dynamic';

const DATASETS = new Set<ResearchDatasetKind>(['sessions', 'showcases', 'retention', 'irr']);
const FORMATS = new Set<ResearchExportFormat>(['csv', 'json', 'xapi']);

export async function GET(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;
  if (!rateLimit(clientKey(req, 'admin-export'), 30)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const url = new URL(req.url);
  const dataset = (url.searchParams.get('dataset') ?? 'sessions') as ResearchDatasetKind;
  const format = (url.searchParams.get('format') ?? 'csv') as ResearchExportFormat;

  if (!DATASETS.has(dataset)) {
    return NextResponse.json({ error: 'invalid_dataset' }, { status: 400 });
  }
  if (!FORMATS.has(format)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }

  const data = await loadAnalyticsSourceData();
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'xapi') {
    const statements = buildXapiStatements(dataset, data);
    return NextResponse.json(
      {
        version: '1.0.3',
        dataset,
        count: statements.length,
        statements,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="gib-${dataset}-${stamp}.xapi.json"`,
        },
      },
    );
  }

  const { columns, rows } = buildDatasetRows(dataset, data);
  if (format === 'json') {
    return NextResponse.json(
      { dataset, count: rows.length, columns, rows },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="gib-${dataset}-${stamp}.json"`,
        },
      },
    );
  }

  const csv = rowsToCsv(columns, rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="gib-${dataset}-${stamp}.csv"`,
    },
  });
}
