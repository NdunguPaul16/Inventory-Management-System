const apiOrigin = process.env.RENDER_API_ORIGIN;

if (!apiOrigin || !/^https:\/\/[^/]+$/.test(apiOrigin)) {
  throw new Error('Set RENDER_API_ORIGIN to the HTTPS origin of the Render backend');
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci --include=dev --prefix ..',
  buildCommand: 'npm run build:shared --prefix .. && npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
