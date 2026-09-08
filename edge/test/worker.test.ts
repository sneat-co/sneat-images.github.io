import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const base64URL = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('media edge', () => {
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

  it('keeps authorized and anonymous transformed responses in separate caches', async () => {
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
      .mockResolvedValue(new Response('image', { status: 200 }));
    const env = {
      ORIGIN_BASE_URL: 'https://api.example',
      MEDIA_ACCESS_PUBLIC_KEY: publicKey,
      MEDIA_ORIGIN_SECRET: 'secret',
    } as never;

    await worker.fetch(
      new Request(
        `https://media.sneat.co/m/${mediaID}/avatar?token=${token}`,
      ),
      env,
    );
    await worker.fetch(
      new Request(`https://media.sneat.co/m/${mediaID}/avatar`),
      env,
    );

    const privateInit = origin.mock.calls[0][1] as RequestInit & {
      cf: { cacheKey: string };
    };
    const publicInit = origin.mock.calls[1][1] as RequestInit & {
      cf: { cacheKey: string };
    };
    expect(privateInit.cf.cacheKey).toContain('access=private');
    expect(publicInit.cf.cacheKey).toContain('access=public');
    expect(privateInit.cf.cacheKey).not.toBe(publicInit.cf.cacheKey);
  });
});
