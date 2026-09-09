import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const base64URL = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('media edge', () => {
  const images = () => {
    const output = vi.fn().mockResolvedValue({
      response: () => new Response('transformed', { headers: { 'Content-Type': 'image/webp' } }),
    });
    const transform = vi.fn().mockReturnValue({ output });
    const input = vi.fn().mockReturnValue({ transform });
    return { binding: { input }, input, transform, output };
  };

  it('rejects unknown variants without contacting origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(new Request('https://media.sneat.co/m/m_abcdefghijklmnopqrstuvwxyz/original'), {
      ORIGIN_BASE_URL: 'https://api.example', MEDIA_ACCESS_PUBLIC_KEY: '', MEDIA_ORIGIN_SECRET: '',
    } as never);
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects malformed access tokens', async () => {
    const response = await worker.fetch(new Request('https://media.sneat.co/m/m_abcdefghijklmnopqrstuvwxyz/avatar?token=bad'), {
      ORIGIN_BASE_URL: 'https://api.example', MEDIA_ACCESS_PUBLIC_KEY: '', MEDIA_ORIGIN_SECRET: '',
    } as never);
    expect(response.status).toBe(403);
  });

  it('preserves an origin error without attempting a transformation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('media not found', { status: 404 }));
    const imageBinding = images();
    const response = await worker.fetch(new Request('https://media.sneat.co/m/m_abcdefghijklmnopqrstuvwxyz/avatar'), {
      ORIGIN_BASE_URL: 'https://api.example', MEDIA_ACCESS_PUBLIC_KEY: '', MEDIA_ORIGIN_SECRET: 'secret', IMAGES: imageBinding.binding,
    } as never);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('media not found');
    expect(imageBinding.input).not.toHaveBeenCalled();
  });

  it('keeps authorized and anonymous transformed responses under separate cache policies', async () => {
    const keys = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const mediaID = 'm_abcdefghijklmnopqrstuvwxyz';
    const header = base64URL(
      new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })),
    );
    const payload = base64URL(
      new TextEncoder().encode(
        JSON.stringify({
          aud: 'media.sneat.co',
          sub: 'user1',
          mediaID,
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      ),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519',
        keys.privateKey,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    );
    const token = `${header}.${payload}.${base64URL(signature)}`;
    const publicKey = btoa(
      Array.from(
        new Uint8Array(
          (await crypto.subtle.exportKey(
            'spki',
            keys.publicKey,
          )) as ArrayBuffer,
        ),
        (byte) => String.fromCharCode(byte),
      ).join(''),
    );
    const origin = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('image', { status: 200 }));
    const imageBinding = images();
    const env = {
      ORIGIN_BASE_URL: 'https://api.example',
      MEDIA_ACCESS_PUBLIC_KEY: publicKey,
      MEDIA_ORIGIN_SECRET: 'secret',
      IMAGES: imageBinding.binding,
    } as never;

    const privateResponse = await worker.fetch(
      new Request(
        `https://media.sneat.co/m/${mediaID}/avatar?token=${token}`,
      ),
      env,
    );
    const publicResponse = await worker.fetch(
      new Request(`https://media.sneat.co/m/${mediaID}/avatar`),
      env,
    );

    const privateHeaders = new Headers((origin.mock.calls[0][1] as RequestInit).headers);
    const publicHeaders = new Headers((origin.mock.calls[1][1] as RequestInit).headers);
    expect(privateHeaders.get('X-Media-Access-Verified')).toBe('private');
    expect(publicHeaders.get('X-Media-Access-Verified')).toBe('public');
    expect(privateResponse.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(publicResponse.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(imageBinding.input).toHaveBeenCalledTimes(2);
    expect(imageBinding.transform).toHaveBeenCalledWith({ width: 96, height: 96, fit: 'cover' });
    expect(imageBinding.output).toHaveBeenCalledWith({ format: 'image/webp', quality: 82 });
  });
});
