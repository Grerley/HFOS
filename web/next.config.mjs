/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Enables getCloudflareContext() (D1 binding, secrets) during `next dev` only.
// Guarded to development so `next build` doesn't open a remote-binding proxy
// for the Workers AI binding (no local simulator; would need CF creds at build).
if (process.env.NODE_ENV === "development") {
  const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
  await initOpenNextCloudflareForDev();
}

export default nextConfig;
