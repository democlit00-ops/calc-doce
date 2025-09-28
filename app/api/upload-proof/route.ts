import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const uid = String(form.get('uid') || '');
    const docId = String(form.get('docId') || '');

    if (!file) return NextResponse.json({ ok: false, error: 'missing file' }, { status: 400 });
    if (!uid) return NextResponse.json({ ok: false, error: 'missing uid' }, { status: 400 });
    if (!docId) return NextResponse.json({ ok: false, error: 'missing docId' }, { status: 400 });

    // caminho amigável na "pasta" do usuário
    const safeName = file.name?.replace(/[^\w.\-]/g, '_') || 'comprovante.png';
    const key = `users/${uid}/bau/${docId}/${Date.now()}_${safeName}`;

    // Faz o upload com acesso público
    const { url } = await put(key, file, {
      access: 'public',
      addRandomSuffix: false,
      contentType: file.type || 'application/octet-stream',
    });

    // TTL sugerido (7 dias) — retornamos para você usar em limpeza posterior
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    return NextResponse.json({ ok: true, url, key, expiresAt });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'upload failed' }, { status: 500 });
  }
}
