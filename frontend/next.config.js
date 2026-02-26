/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for @solana/wallet-adapter and Anchor to work in Next.js
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        os: false,
      };
    }
    // Handle ESM packages
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
  // Transpile Solana packages that use ES modules
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-wallets',
    '@solana/wallet-adapter-phantom',
    '@solana/wallet-adapter-solflare',
  ],
  // Allow images from any source during development
  images: {
    remotePatterns: [],
  },
};

module.exports = nextConfig;
