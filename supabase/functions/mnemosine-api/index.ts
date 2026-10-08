import { createApiHandler } from './handler.ts';

// Tipado mínimo del adaptador; el handler se prueba también bajo Node sin Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve(createApiHandler({ env: (name) => Deno.env.get(name) }));
