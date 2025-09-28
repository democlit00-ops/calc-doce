import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { keys } = (await req.json()) as { keys?: string[] };

    if (!Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json({ ok: false, error: 'keys array required' }, { status: 400 });
    }

    const results: Array<{ key: string; ok: boolean; error?: string }> = [];

    for (const key of keys) {
      try {
        await del(key);
        results.push({ key, ok: true });
      } catch (e: any) {
        results.push({ key, ok: false, error: e?.message || 'delete failed' });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
