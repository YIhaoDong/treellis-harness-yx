const staticDemo = process.env.VITE_TREELLIS_STATIC === 'true'

export default {
  server: {
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'],
    },
  },
  ...(staticDemo ? {
    base: './',
    publicDir: false,
    build: {
      outDir: 'static-demo',
      emptyOutDir: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    worker: {
      format: 'es',
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  } : {}),
}
