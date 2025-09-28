import { put } from '@vercel/blob';

export const runtime = 'edge';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return new Response(JSON.stringify({ error: 'Arquivo não encontrado (chave "file")' }), { status: 400 });
  }

  const safeName = file.name.replace(/\s+/g, '_');
  const filename = `${Date.now()}_${safeName}`;

  const { url } = await put(filename, file, { access: 'public' });
  return Response.json({ url });
}
