const variants = {
  'avatar-xs': { width: 32, height: 32, fit: 'cover' },
  'avatar-sm': { width: 48, height: 48, fit: 'cover' },
  avatar: { width: 96, height: 96, fit: 'cover' },
  'avatar-lg': { width: 192, height: 192, fit: 'cover' },
  thumbnail: { width: 240, height: 240, fit: 'cover' },
  preview: { width: 960, height: 960, fit: 'scale-down' },
  large: { width: 1920, height: 1920, fit: 'scale-down' },
} as const;

type Variant = keyof typeof variants;
type Bindings = Env & { MEDIA_ACCESS_PUBLIC_KEY: string; MEDIA_ORIGIN_SECRET: string };
type Claims = { aud: string; sub: string; mediaID: string; exp: number };

const decodeBase64URL = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const verifyToken = async (token: string, mediaID: string, publicKey: string): Promise<boolean> => {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64URL(parts[1]))) as Claims;
    if (claims.aud !== 'media.sneat.co' || claims.mediaID !== mediaID || claims.exp <= Math.floor(Date.now() / 1000)) return false;
    const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(publicKey), (char) => char.charCodeAt(0)), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', key, decodeBase64URL(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
};

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const bindings = env as Bindings;
    const url = new URL(request.url);
    const match = /^\/m\/(m_[A-Za-z0-9_-]{20,40})\/([a-z-]+)$/.exec(url.pathname);
    if (!match || !(match[2] in variants)) return new Response('not found', { status: 404 });
    const mediaID = match[1];
    const token = url.searchParams.get('token');
    const privateAccess = token ? await verifyToken(token, mediaID, bindings.MEDIA_ACCESS_PUBLIC_KEY) : false;
    if (token && !privateAccess) return new Response('invalid or expired media access', { status: 403 });

    const originURL = new URL('/v0/media/origin', bindings.ORIGIN_BASE_URL);
    originURL.searchParams.set('mediaID', mediaID);
    const response = await fetch(originURL, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${bindings.MEDIA_ORIGIN_SECRET}`,
        'X-Media-Access-Verified': privateAccess ? 'private' : 'public',
      },
    });
    if (!response.ok) return new Response(await response.text(), { status: response.status });
    const cacheControl = privateAccess ? 'private, max-age=300' : 'public, max-age=31536000, immutable';
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: response.status,
        headers: { 'Cache-Control': cacheControl, 'Content-Type': 'image/webp', Vary: 'Accept' },
      });
    }
    if (!response.body) return new Response('origin returned no image body', { status: 502 });

    const transformed = (
      await bindings.IMAGES.input(response.body)
        .transform(variants[match[2] as Variant])
        .output({ format: 'image/webp', quality: 82 })
    ).response();
    const headers = new Headers(transformed.headers);
    headers.set('Cache-Control', cacheControl);
    headers.set('Vary', 'Accept');
    return new Response(transformed.body, { status: transformed.status, headers });
  },
} satisfies ExportedHandler<Env>;
