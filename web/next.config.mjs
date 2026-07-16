/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// Enables getCloudflareContext() (D1 binding, secrets) during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();

export default nextConfig;
