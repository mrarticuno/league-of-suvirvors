import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700, // the vendor chunk is three.js alone (~660 kB), all of it needed before the first frame
    rolldownOptions: {
      output: {
        // three.js in its own chunk: its hash only changes on a three upgrade, so game-only deploys keep it cached
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules[\\/]three/ }] },
      },
    },
  },
});
